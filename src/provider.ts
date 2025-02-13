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
        context.subscriptions.push(vscode.window.registerCustomEditorProvider(
            PdfReaderProvider.viewType,
            new PdfReaderProvider(context),
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: true,
            }));
    }

    constructor(private readonly _context: vscode.ExtensionContext) {
        this.registerNavigation();
        this.registerZoomMode();
        this.registerSpreadMode();
        this.registerScrollMode();
    }

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
        const onReady = webviewPanel.webview.onDidReceiveMessage(async (e) => {
            if (e.type === 'ready') {
                // const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme);
                const config = vscode.workspace.getConfiguration('pdfjs-reader');

                const status = await this.postMessageWithResponse<Status>(webviewPanel, 'open', {
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

                this.updateStatusBar(status);

                onReady.dispose();
            }
        });

        webviewPanel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.active) {
                const status = await this.postMessageWithResponse<Status>(webviewPanel, 'status', {});
                this.updateStatusBar(status);
            }
            if (!this.webviews.active) {
                this.hideStatusBar();
            }
        });

        webviewPanel.onDidDispose(() => {
            if (!this.webviews.active) {
                this.hideStatusBar();
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

    private registerNavigation() {
        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goBack",
            this.goBack.bind(this)));
        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goForward",
            this.goForward.bind(this)));
    }

    private goBack() {
        if (this.webviews.active) {
            this.postMessage(this.webviews.active, 'navigate', { action: 'GoBack' });
        }
    }

    private goForward() {
        if (this.webviews.active) {
            this.postMessage(this.webviews.active, 'navigate', { action: 'GoForward' });
        }
    }

    private updateStatusBar(status: Status) {
        if (status.spreadMode) {
            this.updateSpreadMode(status.spreadMode);
        }

        if (status.scrollMode) {
            this.updateScrollMode(status.scrollMode);
        }

        if (status.zoomMode) {
            this.updateZoomMode(status.zoomMode);
        }
    }

    private hideStatusBar() {
        this.spreadModeStatusBarItem.hide();
        this.scrollModeStatusBarItem.hide();
        this.zoomModeStatusBarItem.hide();
        this.zoomInStatusBarItem.hide();
        this.zoomOutStatusBarItem.hide();
    }

    private static readonly selectSpreadModeCommand = "pdfjsReader.selectSpreadMode";
    private spreadModeStatusBarItem!: vscode.StatusBarItem;

    private registerSpreadMode() {
        this.spreadModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.spreadModeStatusBarItem.command = PdfReaderProvider.selectSpreadModeCommand;
        this.spreadModeStatusBarItem.text = "Spread Mode";

        this._context.subscriptions.push(vscode.commands.registerCommand(PdfReaderProvider.selectSpreadModeCommand,
            this.selectSpreadMode.bind(this)));
        this._context.subscriptions.push(this.spreadModeStatusBarItem);

        return this.spreadModeStatusBarItem;
    }

    private static readonly spreadModes: Array<vscode.QuickPickItem & { mode: SpreadMode }> = [
        { mode: 'none', label: "Single", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-none") },
        { mode: 'odd', label: "Odd", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") },
        { mode: 'even', label: "Even", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") }
    ];

    private async selectSpreadMode() {
        if (this.webviews.active) {
            const selected = await vscode.window.showQuickPick(PdfReaderProvider.spreadModes, { title: "Spread Pages" });

            if (selected) {
                this.postMessage(this.webviews.active, 'view', { spreadMode: selected.mode });
                this.updateSpreadMode(selected.mode)
            }
        }
    }

    private updateSpreadMode(mode: SpreadMode) {
        const selected = PdfReaderProvider.spreadModes.find(m => m.mode == mode);
        if (selected) {
            this.spreadModeStatusBarItem.text = `$(${(selected.iconPath as vscode.ThemeIcon).id}) ${selected.label}`;
            this.spreadModeStatusBarItem.show();
        } else {
            this.spreadModeStatusBarItem.hide();
        }
    }

    private static readonly selectScrollModeCommand = "pdfjsReader.selectScrollMode";
    private scrollModeStatusBarItem!: vscode.StatusBarItem;

    private registerScrollMode() {
        this.scrollModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.scrollModeStatusBarItem.command = PdfReaderProvider.selectScrollModeCommand;
        this.scrollModeStatusBarItem.text = "Scroll Mode";

        this._context.subscriptions.push(vscode.commands.registerCommand(PdfReaderProvider.selectScrollModeCommand,
            this.selectScrollMode.bind(this)));
        this._context.subscriptions.push(this.scrollModeStatusBarItem);
    }

    private static readonly scrollModes: Array<vscode.QuickPickItem & { mode: ScrollMode }> = [
        { mode: 'page', label: "Page", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-page") },
        { mode: 'vertical', label: "Vertical", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-vertical") },
        { mode: 'horizontal', label: "Horizontal", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-horizontal") },
        { mode: 'wrapped', label: "Wrapped", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-wrapped") }
    ];

    private async selectScrollMode() {
        if (this.webviews.active) {
            const selected = await vscode.window.showQuickPick(PdfReaderProvider.scrollModes, { title: "Scroll Mode" });

            if (selected) {
                this.postMessage(this.webviews.active, 'view', { scrollMode: selected.mode });
                this.updateScrollMode(selected.mode)
            }
        }
    }

    private updateScrollMode(mode: ScrollMode) {
        const selected = PdfReaderProvider.scrollModes.find(m => m.mode == mode);
        if (selected) {
            this.scrollModeStatusBarItem.text = `$(${(selected.iconPath as vscode.ThemeIcon).id}) ${selected.label}`;
            this.scrollModeStatusBarItem.show();
        } else {
            this.scrollModeStatusBarItem.hide();
        }
    }

    private static readonly selectZoomModeCommand = "pdfjsReader.selectZoomMode";
    private zoomModeStatusBarItem!: vscode.StatusBarItem;
    private static readonly selectZoomInCommand = "pdfjsReader.zoomIn";
    private zoomInStatusBarItem!: vscode.StatusBarItem;
    private static readonly selectZoomOutCommand = "pdfjsReader.zoomOut";
    private zoomOutStatusBarItem!: vscode.StatusBarItem;

    private registerZoomMode() {
        this.zoomModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
        this.zoomModeStatusBarItem.command = PdfReaderProvider.selectZoomModeCommand;
        this.zoomModeStatusBarItem.text = "Zoom Mode";

        this._context.subscriptions.push(vscode.commands.registerCommand(PdfReaderProvider.selectZoomModeCommand,
            this.selectZoomMode.bind(this)));
        this._context.subscriptions.push(this.zoomModeStatusBarItem);

        this.zoomInStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 109);
        this.zoomInStatusBarItem.command = PdfReaderProvider.selectZoomInCommand;
        this.zoomInStatusBarItem.text = "$(pdfjs-reader-zoom-in)";

        this._context.subscriptions.push(vscode.commands.registerCommand(PdfReaderProvider.selectZoomInCommand,
            this.zoomIn.bind(this)));
        this._context.subscriptions.push(this.zoomInStatusBarItem);

        this.zoomOutStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 111);
        this.zoomOutStatusBarItem.command = PdfReaderProvider.selectZoomOutCommand;
        this.zoomOutStatusBarItem.text = "$(pdfjs-reader-zoom-out)";

        this._context.subscriptions.push(vscode.commands.registerCommand(PdfReaderProvider.selectZoomOutCommand,
            this.zoomOut.bind(this)));
        this._context.subscriptions.push(this.zoomOutStatusBarItem);
    }

    private static readonly zoomModes: Array<vscode.QuickPickItem & { mode: ZoomMode | undefined }> = [
        { mode: 'auto', label: "Automatic Zoom" },
        { mode: 'page-actual', label: "Actual Size" },
        { mode: 'page-width', label: "Page Width" },
        { mode: 'page-height', label: "Page Height" },
        { mode: 'page-fit', label: "Page Fit" },
        { mode: 0.5, label: "50%" },
        { mode: 0.75, label: "75%" },
        { mode: 1.0, label: "100%" },
        { mode: 1.25, label: "125%" },
        { mode: 1.5, label: "150%" },
        { mode: undefined, label: "Custom" },
        // { mode: 2.0, label: "200%" },
        // { mode: 3.0, label: "300%" },
        // { mode: 4.0, label: "400%" }
    ];


    private async selectZoomMode() {
        if (this.webviews.active) {
            const selected = await vscode.window.showQuickPick(PdfReaderProvider.zoomModes, { title: "Zoom Mode" });

            if (selected) {
                if (selected.mode) {
                    this.postMessage(this.webviews.active, 'view', { zoomMode: { scale: selected.mode } });
                    this.updateZoomMode(selected.mode);
                } else {
                    const custom = Number(await vscode.window.showInputBox({ title: "Custom Zoom" })) / 100;
                    if (!isNaN(custom)) {
                        this.postMessage(this.webviews.active, 'view', { zoomMode: { scale: custom } });
                        this.updateZoomMode(custom);
                    }
                }
            }
        }
    }

    private updateZoomMode(mode: ZoomMode) {
        const selected = PdfReaderProvider.zoomModes.find(m => m.mode == mode);
        if (selected) {
            this.zoomModeStatusBarItem.text = selected.label;
        } else if (!isNaN(mode = Number(mode))) {
            this.zoomModeStatusBarItem.text =
                new Intl.NumberFormat('default', {
                    style: 'percent',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                }).format(mode);
        }

        this.zoomModeStatusBarItem.show();
        this.zoomInStatusBarItem.show();
        this.zoomOutStatusBarItem.show();
    }

    private zoomIn() {
        if (this.webviews.active) {
            this.postMessage(this.webviews.active, 'view', { zoomMode: { steps: +1 } });
        }
    }

    private zoomOut() {
        if (this.webviews.active) {
            this.postMessage(this.webviews.active, 'view', { zoomMode: { steps: -1 } });
        }
    }
}

type SpreadMode = 'none' | 'odd' | 'even';

type ScrollMode = 'page' | 'vertical' | 'horizontal' | 'wrapped';

type ZoomMode = 'auto' | 'page-actual' | 'page-width' | 'page-height' | 'page-fit' | number;

interface Status {
    spreadMode?: SpreadMode;
    scrollMode?: ScrollMode;
    zoomMode?: ZoomMode;
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
