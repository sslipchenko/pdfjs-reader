import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import path from 'path';

interface PdfDocumentDelegate {
    getDocumentData(): Promise<Uint8Array>;
}

class PdfDocument extends Disposable implements vscode.CustomDocument {
    private readonly _uri: vscode.Uri;
    private readonly _dataFile: vscode.Uri;
    private readonly _delegate: PdfDocumentDelegate;
    private _force = true;

    static async create(uri: vscode.Uri, backupId: string | undefined, delegate: PdfDocumentDelegate): Promise<PdfDocument | PromiseLike<PdfDocument>> {
        // If we have a backup, read that. Otherwise read the resource from the workspace
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        return new PdfDocument(uri, dataFile, delegate);
    }

    private constructor(uri: vscode.Uri, dataFile: vscode.Uri, delegate: PdfDocumentDelegate) {
        super();

        this._uri = uri;
        this._dataFile = dataFile;
        this._delegate = delegate;

        const watcher = this._register(vscode.workspace.createFileSystemWatcher(uri.fsPath));
        this._register(watcher.onDidChange((e) => {
            if (e.fsPath === this.uri.fsPath) {
                this._onDidChangeDocument.fire({ dataFile: this.uri, force: this._force });
                this._force = true;
            }
        }));
    }

    public get uri() { return this._uri; }

    public get dataFile() { return this._dataFile; }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
        readonly dataFile: vscode.Uri;
        readonly force?: boolean;
    }>());
    public readonly onDidChangeDocument = this._onDidChangeDocument.event;

    dispose(): void {
        this._onDidDispose.fire();
        super.dispose();
    }

    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
    }

    async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        const fileData = await this._delegate.getDocumentData();
        if (!cancellation.isCancellationRequested) {
            this._force = false;
            await vscode.workspace.fs.writeFile(targetResource, fileData);
        }
    }

    async revert(cancellation: vscode.CancellationToken): Promise<void> {
        this._onDidChangeDocument.fire({ dataFile: this.uri, force: true });
    }

    async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        if (cancellation.isCancellationRequested) {
            throw new Error("Backup canceled");
        }

        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch {
                    // noop
                }
            }
        };
    }
}

export class PdfReaderProvider implements vscode.CustomEditorProvider<PdfDocument> {
    private static readonly viewType = 'pdfjsReader.pdfReader';
    private _viewerHtml: string | undefined;

    public static register(context: vscode.ExtensionContext) {
        const provider = new PdfReaderProvider(context);

        // register PDF editor provider
        context.subscriptions.push(vscode.window.registerCustomEditorProvider(
            PdfReaderProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: true,
            }));

        // register navigation commands
        context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goBack", provider.goBack.bind(provider)));
        context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goForward", provider.goForward.bind(provider)));
    }

    constructor(private readonly _context: vscode.ExtensionContext) { }

    async openCustomDocument(uri: vscode.Uri, openContext: { backupId?: string }, _token: vscode.CancellationToken): Promise<PdfDocument> {
        const document: PdfDocument = await PdfDocument.create(uri, openContext.backupId, {
            getDocumentData: async () => {
                const webviewsForDocument =
                    Array.from(this.webviews.get(document.uri))
                        .filter(webview => webview.active);
                if (!webviewsForDocument.length) {
                    throw new Error('Could not find webview to save for');
                }

                const panel = webviewsForDocument[0];
                const response = await this.postMessageWithResponse<number[]>(panel, 'save', {});
                return new Uint8Array(response);
            }
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChangeDocument(e => {
            for (const webviewPanel of this.webviews.get(document.uri)) {
                if (e.force || !webviewPanel.active) {
                    this.postMessage(webviewPanel, 'reload',
                        { document: { url: webviewPanel.webview.asWebviewUri(e.dataFile).toString() } });
                }
            }
        }));

        document.onDidDispose(() => disposeAll(listeners));

        return document;
    }

    private readonly webviews = new WebviewCollection();

    public get activeWebview(): vscode.WebviewPanel | undefined { return this.webviews.active; }

    async resolveCustomEditor(document: PdfDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {
        // Add the webview to our internal set of active webviews
        this.webviews.add(document.uri, webviewPanel);

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'lib'),
                document.dataFile.with({ path: path.dirname(document.dataFile.path) })
            ]
        };

        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

        // Wait for the webview to be properly ready before we init
        const onReady = webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                // const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme);
                const config = vscode.workspace.getConfiguration('pdfjs-reader');

                this.postMessage(webviewPanel, 'open', {
                    document: { url: webviewPanel.webview.asWebviewUri(document.dataFile).toString() },
                    cMapUrl: this.resolveAsUri(webviewPanel, 'lib', 'web', 'cmaps'),
                    standardFontDataUrl: this.resolveAsUri(webviewPanel, 'lib', 'web', 'standard_fonts'),
                    defaults: {
                        cursor: config.get('default.cursor') as string,
                        zoom: config.get('default.zoom') as string,
                        sidebarView: config.get('default.sidebarView') as string,
                        scrollMode: config.get('default.scrollMode') as string,
                        spreadMode: config.get('default.spreadMode') as string
                    }
                });

                onReady.dispose();
            }
        });
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<PdfDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public saveCustomDocument(document: PdfDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.save(cancellation);
    }

    public saveCustomDocumentAs(document: PdfDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.saveAs(destination, cancellation);
    }

    public revertCustomDocument(document: PdfDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.revert(cancellation);
    }

    public backupCustomDocument(document: PdfDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    public goBack() {
        if (this.webviews.active) {
            this.webviews.active.webview.postMessage({ type: 'navigate', body: { action: 'GoBack' } });
        }
    }

    public goForward() {
        if (this.webviews.active) {
            this.webviews.active.webview.postMessage({ type: 'navigate', body: { action: 'GoForward' } });
        }
    }

    private async getHtmlForWebview(webviewPanel: vscode.WebviewPanel): Promise<string> {
        const html = (await this.getViewerHtml())
            .replace('locale/locale.json', this.resolveAsUri(webviewPanel, 'lib', 'web', 'locale', 'locale.json').toString())
            .replace('../build/pdf.mjs', this.resolveAsUri(webviewPanel, 'lib', 'build', 'pdf.mjs').toString())
            .replace('<link rel="stylesheet" href="viewer.css">',
                `<link rel="stylesheet" href="${this.resolveAsUri(webviewPanel, 'lib', 'web', 'viewer.css').toString()}">\n` +
                `<link rel="stylesheet" href="${this.resolveAsUri(webviewPanel, 'lib', 'controller.css').toString()}">`)
            .replace('<script src="viewer.mjs" type="module"></script>',
                `<script src="${this.resolveAsUri(webviewPanel, 'lib', 'controller.mjs').toString()}" type="module"></script>\n` +
                `<script src="${this.resolveAsUri(webviewPanel, 'lib', 'web', 'viewer.mjs').toString()}" type="module"></script>`);

        return html;
    }

    private async getViewerHtml(): Promise<string> {
        if (!this._viewerHtml) {
            this._viewerHtml = Buffer.from(
                await vscode.workspace.fs.readFile(
                    vscode.Uri.joinPath(this._context.extensionUri, 'lib', 'web', 'viewer.html')))
                .toString('utf8');
        }

        return this._viewerHtml;
    }

    private resolveAsUri(webviewPanel: vscode.WebviewPanel, ...p: string[]): vscode.Uri {
        return webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, ...p));
    }

    private _requestId = 1;
    private readonly _callbacks = new Map<number, (response: any) => void>();

    private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
        const requestId = this._requestId++;
        const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
        panel.webview.postMessage({ type, requestId, body });
        return p;
    }

    private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
        panel.webview.postMessage({ type, body });
    }

    private onMessage(document: PdfDocument, message: any) {
        switch (message.type) {
            case 'response':
                {
                    const callback = this._callbacks.get(message.requestId);
                    callback?.(message.body);
                }
                break;
        }
    }
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {

    private readonly _webviews = new Set<{
        readonly resource: string;
        readonly webviewPanel: vscode.WebviewPanel;
    }>();

    public get active(): vscode.WebviewPanel | undefined {
        for (const entry of this._webviews) {
            if (entry.webviewPanel.active) {
                return entry.webviewPanel;
            }
        }
    }

    /**
     * Get all known webviews for a given uri.
     */
    public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
        const key = uri.toString();
        for (const entry of this._webviews) {
            if (entry.resource === key) {
                yield entry.webviewPanel;
            }
        }
    }

    /**
     * Add a new webview to the collection.
     */
    public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
        const entry = { resource: uri.toString(), webviewPanel };
        this._webviews.add(entry);

        webviewPanel.onDidDispose(() => {
            this._webviews.delete(entry);
        });
    }
}
