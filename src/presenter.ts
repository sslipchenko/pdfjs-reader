import * as vscode from 'vscode';
import { PdfDocument } from './document';
import { Disposable } from './dispose';

export type SpreadMode = 'none' | 'odd' | 'even';

export type ScrollMode = 'page' | 'vertical' | 'horizontal' | 'wrapped';

export type ZoomMode = 'auto' | 'page-actual' | 'page-width' | 'page-height' | 'page-fit' | number;

export type Pages = { current: number; total: number; };

export interface Status {
    spreadMode?: SpreadMode;
    scrollMode?: ScrollMode;
    zoomMode?: ZoomMode;
    pagesRotation?: number;
    pages?: Pages;
}

export class PdfPresenter extends Disposable {
    private static _viewerHtml: string | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        readonly document: PdfDocument,
        readonly webviewPanel: vscode.WebviewPanel) {
        super();

        this.getHtmlForWebview().then(html => webviewPanel.webview.html = html);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(e));

        const onReady = webviewPanel.webview.onDidReceiveMessage(e => {
            const config = vscode.workspace.getConfiguration('pdfjs-reader');

            this.postMessage('open', {
                document: { url: webviewPanel.webview.asWebviewUri(document.dataFile).toString() },
                cMapUrl: this.resolveAsUri('lib', 'web', 'cmaps'),
                standardFontDataUrl: this.resolveAsUri('lib', 'web', 'standard_fonts'),
                defaults: {
                    cursor: config.get('default.cursor') as string,
                    zoom: config.get('default.zoom') as string,
                    sidebarView: config.get('default.sidebarView') as string,
                    scrollMode: config.get('default.scrollMode') as string,
                    spreadMode: config.get('default.spreadMode') as string
                }
            });


            onReady.dispose();
        });

        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                this.postMessage('status', {});
            } else {
                this._onDidChange.fire({ presenter: this })
            }
        });

        webviewPanel.onDidDispose(e => {
            this.dispose();
        });
    }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    dispose(): void {
        this._onDidChange.fire({ presenter: this });
        this._onDidDispose.fire();
        super.dispose();
    }

    private readonly _onDidChange = this._register(new vscode.EventEmitter<{
        readonly presenter: PdfPresenter;
        readonly status?: Status;
    }>);
    public readonly onDidChange = this._onDidChange.event;

    save() {
        return this.postMessageWithResponse<number[]>('save', {});
    }

    reload(dataFile: vscode.Uri) {
        this.postMessage('reload', { document: { url: this.webviewPanel.webview.asWebviewUri(dataFile).toString() } });
    }

    navigate(options: { action?: string; page?: number }) {
        this.postMessage('navigate', options);
    }

    view(options: {
        spreadMode?: SpreadMode;
        scrollMode?: ScrollMode;
        zoomMode?: { scale?: ZoomMode; steps?: number };
        pagesRotation?: { delta: number }
    }) {
        this.postMessage('view', options);
    }

    private _requestId = 1;
    private readonly _callbacks = new Map<number, (response: any) => void>();

    private postMessageWithResponse<R = unknown>(type: string, body: any): Promise<R> {
        const requestId = this._requestId++;
        const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
        this.webviewPanel.webview.postMessage({ type, requestId, body });
        return p;
    }

    private postMessage(type: string, body: any): void {
        this.webviewPanel.webview.postMessage({ type, body });
    }

    private onMessage(message: any) {
        switch (message.type) {
            case 'response':
                this._callbacks.get(message.requestId)?.(message.body);
                this._callbacks.delete(message.requestId);
                break;
            case 'status':
                this._onDidChange.fire({ presenter: this, status: message.body });
                break;
        }
    }

    private resolveAsUri(...p: string[]): vscode.Uri {
        return this.webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, ...p));
    }

    private async getHtmlForWebview(): Promise<string> {
        const html = (await this.getViewerHtml())
            .replace('locale/locale.json', this.resolveAsUri('lib', 'web', 'locale', 'locale.json').toString())
            .replace('../build/pdf.mjs', this.resolveAsUri('lib', 'build', 'pdf.mjs').toString())
            .replace('<link rel="stylesheet" href="viewer.css">',
                `<link rel="stylesheet" href="${this.resolveAsUri('lib', 'web', 'viewer.css').toString()}">\n` +
                `<link rel="stylesheet" href="${this.resolveAsUri('lib', 'controller.css').toString()}">`)
            .replace('<script src="viewer.mjs" type="module"></script>',
                `<script src="${this.resolveAsUri('lib', 'controller.mjs').toString()}" type="module"></script>\n` +
                `<script src="${this.resolveAsUri('lib', 'web', 'viewer.mjs').toString()}" type="module"></script>`);

        return html;
    }

    private async getViewerHtml(): Promise<string> {
        if (!PdfPresenter._viewerHtml) {
            PdfPresenter._viewerHtml = Buffer.from(
                await vscode.workspace.fs.readFile(
                    vscode.Uri.joinPath(this._context.extensionUri, 'lib', 'web', 'viewer.html')))
                .toString('utf8');
        }

        return PdfPresenter._viewerHtml;
    }
}

export class PdfPresenterCollection {
    private readonly _presenters = new Set<{
        readonly resource: string;
        readonly presenter: PdfPresenter;
    }>();

    /**
     * Get active presenter
     */
    public get active(): PdfPresenter | undefined {
        for (const entry of this._presenters) {
            if (entry.presenter.webviewPanel.active) {
                return entry.presenter;
            }
        }
    }

    /**
         * Get all known presenters for a given uri.
         */
    public *get(uri: vscode.Uri): Iterable<PdfPresenter> {
        const key = uri.toString();
        for (const entry of this._presenters) {
            if (entry.resource === key) {
                yield entry.presenter;
            }
        }
    }

    /**
     * Add a new preesenter to the collection.
     */
    public add(presenter: PdfPresenter) {
        const entry = { resource: presenter.document.uri.toString(), presenter };
        this._presenters.add(entry);

        presenter.onDidDispose(() => {
            this._presenters.delete(entry);
        });
    }
}
