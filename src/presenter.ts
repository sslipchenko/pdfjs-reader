import * as vscode from 'vscode';
import { Disposable } from './dispose';
import { PdfDocument } from './document';

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

export interface FindState {
    query: string;
    options: {
        highlightAll?: boolean;
        caseSensitive?: boolean;
        entireWord?: boolean;
        matchDiacritics?: boolean;
    }
}

export interface ViewState {
    spreadMode?: SpreadMode;
    scrollMode?: ScrollMode;
    zoomMode?: ZoomMode;
    outlineSize?: string;
}

export interface DocumentState {
    pageNumber?: number;
}

export class PdfPresenter extends Disposable {
    private static _classicHtml: string | undefined;
    private static _vscodeHtml: string | undefined;

    private static readonly DOCUMENT_STATE = "pdfjs-reader.document";
    private static readonly VIEW_STATE = "pdfjs-reader.view";
    private static readonly DEFAULT_VIEW_STATE: ViewState = {
        spreadMode: 'none',
        scrollMode: 'vertical',
        zoomMode: 'auto',
        outlineSize: '200px'
    };
    private static readonly FIND_STATE = 'pdfjs-reader.find';

    constructor(
        private readonly _context: vscode.ExtensionContext,
        readonly document: PdfDocument,
        readonly webviewPanel: vscode.WebviewPanel) {
        super();

        this.getHtmlForWebview().then(html => webviewPanel.webview.html = html);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(e));

        const onReady = webviewPanel.webview.onDidReceiveMessage(e => {
            const documentState = this._context.workspaceState.get<Record<string, DocumentState>>(PdfPresenter.DOCUMENT_STATE, {});
            const viewState = this._context.workspaceState.get<ViewState>(PdfPresenter.VIEW_STATE, PdfPresenter.DEFAULT_VIEW_STATE);

            this.postMessage('open', {
                document: { url: webviewPanel.webview.asWebviewUri(document.dataFile).toString() },
                cMapUrl: this.resolveAsUri('lib', 'web', 'cmaps'),
                standardFontDataUrl: this.resolveAsUri('lib', 'web', 'standard_fonts'),
                defaults: {
                    pageNumber: documentState[this.document.uri.fsPath]?.pageNumber ?? 1,
                    ...viewState
                }
            });


            onReady.dispose();
        });

        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                this.postMessage('status', {});
            } else {
                this._status = undefined;
                this._onDidChange.fire({ presenter: this })
            }
        });

        webviewPanel.onDidDispose(e => {
            this._status = undefined;
            this.dispose();
        });
    }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    dispose(): void {
        this._onDidDispose.fire();
        this._onDidChange.fire({ presenter: this });
        super.dispose();
    }

    private _status?: Status;
    private readonly _onDidChange = this._register(new vscode.EventEmitter<{
        readonly presenter: PdfPresenter;
    }>);
    public readonly onDidChange = this._onDidChange.event;

    public get status() { return this._status; }

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

    find() {
        const findState = this._context.workspaceState.get<FindState>(PdfPresenter.FIND_STATE, {
            query: '', options: {}
        });

        this.postMessage('find', findState);
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
                this._status = message.body;
                this._onDidChange.fire({ presenter: this });

                if (message.body.pages?.current) {
                    const documentState = this._context.workspaceState.get<Record<string, DocumentState>>(PdfPresenter.DOCUMENT_STATE, {});
                    this._context.workspaceState.update(PdfPresenter.DOCUMENT_STATE,
                        { ...documentState, [this.document.uri.fsPath]: { pageNumber: this.status?.pages?.current } });
                }

                const viewState = this._context.workspaceState.get<ViewState>(PdfPresenter.VIEW_STATE, PdfPresenter.DEFAULT_VIEW_STATE);
                let newState = viewState;

                if (message.body.zoomMode && viewState.zoomMode !== message.body.zoomMode) {
                    newState = { ...newState, zoomMode: message.body.zoomMode };
                }

                if (message.body.scrollMode && viewState.scrollMode !== message.body.scrollMode) {
                    newState = { ...newState, scrollMode: message.body.scrollMode };
                }

                if (message.body.spreadMode && viewState.spreadMode !== message.body.spreadMode) {
                    newState = { ...newState, spreadMode: message.body.spreadMode };
                }

                if (message.body.outlineSize && viewState.outlineSize !== message.body.outlineSize) {
                    newState = { ...newState, outlineSize: message.body.outlineSize };
                }

                if (viewState !== newState) {
                    this._context.workspaceState.update(PdfPresenter.VIEW_STATE, newState);
                }

                break;
            case 'find':
                this._context.workspaceState.update(PdfPresenter.FIND_STATE, message.body);
                break;
        }
    }

    private resolveAsUri(...p: string[]): vscode.Uri {
        return this.webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, ...p));
    }

    private isNewUI = true;

    private async getHtmlForWebview(): Promise<string> {
        if (this.isNewUI) {
            return (await this.getViewHtml())
                .replaceAll("./", this.resolveAsUri('dist', 'view/').toString());
        } else {
            return (await this.getViewHtml())
                .replace('locale/locale.json', this.resolveAsUri('lib', 'web', 'locale', 'locale.json').toString())
                .replace('../build/pdf.mjs', this.resolveAsUri('lib', 'build', 'pdf.mjs').toString())
                .replace('<link rel="stylesheet" href="viewer.css">',
                    `<link rel="stylesheet" href="${this.resolveAsUri('lib', 'web', 'viewer.css').toString()}">\n` +
                    `<link rel="stylesheet" href="${this.resolveAsUri('lib', 'controller.css').toString()}">`)
                .replace('<script src="viewer.mjs" type="module"></script>',
                    `<script src="${this.resolveAsUri('lib', 'controller.mjs').toString()}" type="module"></script>\n` +
                    `<script src="${this.resolveAsUri('lib', 'web', 'viewer.mjs').toString()}" type="module"></script>`);
        }
    }

    private async getViewHtml(): Promise<string> {
        if (this.isNewUI) {
            if (!PdfPresenter._vscodeHtml) {
                PdfPresenter._vscodeHtml = Buffer.from(
                    await vscode.workspace.fs.readFile(
                        vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'view', 'view.html')))
                    .toString('utf8');
            }

            return PdfPresenter._vscodeHtml;
        } else {
            if (!PdfPresenter._classicHtml) {
                PdfPresenter._classicHtml = Buffer.from(
                    await vscode.workspace.fs.readFile(
                        vscode.Uri.joinPath(this._context.extensionUri, 'lib', 'web', 'viewer.html')))
                    .toString('utf8');
            }

            return PdfPresenter._classicHtml;
        }
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
     * Add a new presenter to the collection.
     */
    public add(presenter: PdfPresenter) {
        const entry = { resource: presenter.document.uri.toString(), presenter };
        this._presenters.add(entry);

        presenter.onDidDispose(() => {
            this._presenters.delete(entry);
        });
    }
}
