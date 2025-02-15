import path from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { PdfDocument } from './document';
import { PdfPresenter, PdfPresenterCollection, Status, SpreadMode, ScrollMode, ZoomMode, Pages } from './presenter';

export class PdfProvider implements vscode.CustomEditorProvider<PdfDocument> {
    private static readonly viewType = 'pdfjsReader.pdfReader';

    public static register(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.window.registerCustomEditorProvider(
            PdfProvider.viewType,
            new PdfProvider(context),
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: true,
            }));
    }

    constructor(private readonly _context: vscode.ExtensionContext) {
        this.registerNavigation();
        this.registerRotation();
        this.registerZoomMode();
        this.registerSpreadMode();
        this.registerScrollMode();
    }

    async openCustomDocument(uri: vscode.Uri, openContext: { backupId?: string }, _token: vscode.CancellationToken): Promise<PdfDocument> {
        const document: PdfDocument = await PdfDocument.create(uri, openContext.backupId, {
            getDocumentData: async () => {
                const presentersForDocument =
                    Array.from(this.presenters.get(document.uri))
                        .filter(presenter => presenter.webviewPanel.active);
                if (!presentersForDocument.length) {
                    throw new Error('Could not find webview to save for');
                }

                const presenter = presentersForDocument[0];
                const response = await presenter.postMessageWithResponse<number[]>('save', {});
                return new Uint8Array(response);
            }
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChangeDocument(e => {
            for (const presenter of this.presenters.get(document.uri)) {
                if (e.force || !presenter.webviewPanel.active) {
                    presenter.postMessage('reload',
                        { document: { url: presenter.webviewPanel.webview.asWebviewUri(e.dataFile).toString() } });
                }
            }
        }));

        document.onDidDispose(() => disposeAll(listeners));

        return document;
    }

    private readonly presenters = new PdfPresenterCollection();

    async resolveCustomEditor(document: PdfDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {
        const presenter = new PdfPresenter(this._context, document, webviewPanel);
        this.presenters.add(presenter);

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'lib'),
                document.dataFile.with({ path: path.dirname(document.dataFile.path) })
            ]
        };

        webviewPanel.webview.onDidReceiveMessage((e) => {
            if (e.type === 'status') {
                this.updateStatusBar(e.body);
            }
        });

        webviewPanel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.active) {
                presenter.postMessage('status', {});
            }
            if (!this.presenters.active) {
                this.hideStatusBar();
            }
        });

        webviewPanel.onDidDispose(() => {
            if (!this.presenters.active) {
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

        if (status.pagesRotation !== undefined) {
            this.updateRotation(status.pagesRotation);
        }

        if (status.pages) {
            this.updatePages(status.pages);
        }
    }

    private hideStatusBar() {
        this.spreadModeStatusBarItem.hide();
        this.scrollModeStatusBarItem.hide();

        this.zoomModeStatusBarItem.hide();
        this.zoomInStatusBarItem.hide();
        this.zoomOutStatusBarItem.hide();

        this.rotationStatusBarItem.hide();
        this.rotateLeftStatusBarItem.hide();
        this.rotateRightStatusBarItem.hide();

        this.firstPageStatusBarItem.hide();
        this.prevPageStatusBarItem.hide();
        this.goToPageStatusBarItem.hide();
        this.nextPageStatusBarItem.hide();
        this.lastPageStatusBarItem.hide();
    }

    private registerStatusBarItem({
        priority,
        command,
        text,
        callback
    }: {
        priority: number;
        command: string;
        text: string;
        callback: (...args: any[]) => any;
    }) {
        this._context.subscriptions.push(vscode.commands.registerCommand(command, callback, this));

        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
        item.command = command;
        item.text = text

        this._context.subscriptions.push(item);

        return item;
    }

    private static readonly goToPageCommand = "pdfjsReader.goToPage";
    private goToPageStatusBarItem!: vscode.StatusBarItem;

    private static readonly prevPageCommand = "pdfjsReader.prevPage";
    private prevPageStatusBarItem!: vscode.StatusBarItem;

    private static readonly nextPageCommand = "pdfjsReader.nextPage";
    private nextPageStatusBarItem!: vscode.StatusBarItem;

    private static readonly firstPageCommand = "pdfjsReader.firstPage";
    private firstPageStatusBarItem!: vscode.StatusBarItem;

    private static readonly lastPageCommand = "pdfjsReader.lastPage";
    private lastPageStatusBarItem!: vscode.StatusBarItem;

    private registerNavigation() {
        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goBack",
            this.goBack, this));
        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goForward",
            this.goForward, this));

        this.firstPageStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.firstPageCommand,
            callback: this.firstPage,
            priority: 132,
            text: "$(pdfjs-reader-page-first)"
        });

        this.prevPageStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.prevPageCommand,
            callback: this.prevPage,
            priority: 131,
            text: "$(pdfjs-reader-page-prev)"
        });

        this.goToPageStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.goToPageCommand,
            callback: this.goToPage,
            priority: 130,
            text: "Go to Page"
        });

        this.nextPageStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.nextPageCommand,
            callback: this.nextPage,
            priority: 129,
            text: "$(pdfjs-reader-page-next)"
        });

        this.lastPageStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.lastPageCommand,
            callback: this.lastPage,
            priority: 128,
            text: "$(pdfjs-reader-page-last)"
        });
    }

    private updatePages({ current, total }: Pages) {
        this.firstPageStatusBarItem.show();
        this.prevPageStatusBarItem.show();
        this.goToPageStatusBarItem.text = `${current} of ${total}`;
        this.goToPageStatusBarItem.show();
        this.nextPageStatusBarItem.show();
        this.lastPageStatusBarItem.show();
    }

    private goBack() {
        this.presenters.active?.postMessage('navigate', { action: 'GoBack' });
    }

    private goForward() {
        this.presenters.active?.postMessage('navigate', { action: 'GoForward' });
    }

    private async goToPage() {
        if (this.presenters.active) {
            const page = await vscode.window.showInputBox({ title: "Go to Page" });
            if (page) {
                this.presenters.active.postMessage('navigate', { page: Number(page) });
            }
        }
    }

    private nextPage() {
        this.presenters.active?.postMessage('navigate', { action: 'next' });
    }

    private prevPage() {
        this.presenters.active?.postMessage('navigate', { action: 'prev' });
    }

    private firstPage() {
        this.presenters.active?.postMessage('navigate', { action: 'first' });
    }

    private lastPage() {
        this.presenters.active?.postMessage('navigate', { action: 'last' });
    }

    private static readonly selectSpreadModeCommand = "pdfjsReader.selectSpreadMode";
    private spreadModeStatusBarItem!: vscode.StatusBarItem;

    private registerSpreadMode() {
        this.spreadModeStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.selectSpreadModeCommand,
            callback: this.selectSpreadMode,
            priority: 100,
            text: "Spread Mode"
        })
    }

    private static readonly spreadModes: Array<vscode.QuickPickItem & { mode: SpreadMode }> = [
        { mode: 'none', label: "Single", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-none") },
        { mode: 'odd', label: "Odd", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") },
        { mode: 'even', label: "Even", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") }
    ];

    private async selectSpreadMode() {
        if (this.presenters.active) {
            const selected = await vscode.window.showQuickPick(PdfProvider.spreadModes, { title: "Spread Pages" });
            if (selected) {
                this.presenters.active.postMessage('view', { spreadMode: selected.mode });
            }
        }
    }

    private updateSpreadMode(mode: SpreadMode) {
        const selected = PdfProvider.spreadModes.find(m => m.mode == mode);
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
        this.scrollModeStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.selectScrollModeCommand,
            callback: this.selectScrollMode,
            priority: 100,
            text: "Scroll Mode"
        });
    }

    private static readonly scrollModes: Array<vscode.QuickPickItem & { mode: ScrollMode }> = [
        { mode: 'page', label: "Page", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-page") },
        { mode: 'vertical', label: "Vertical", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-vertical") },
        { mode: 'horizontal', label: "Horizontal", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-horizontal") },
        { mode: 'wrapped', label: "Wrapped", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-wrapped") }
    ];

    private async selectScrollMode() {
        if (this.presenters.active) {
            const selected = await vscode.window.showQuickPick(PdfProvider.scrollModes, { title: "Scroll Mode" });
            if (selected) {
                this.presenters.active.postMessage('view', { scrollMode: selected.mode });
            }
        }
    }

    private updateScrollMode(mode: ScrollMode) {
        const selected = PdfProvider.scrollModes.find(m => m.mode == mode);
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
        this.zoomModeStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.selectZoomModeCommand,
            callback: this.selectZoomMode,
            priority: 120,
            text: "Zoom Mode"
        });

        this.zoomInStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.selectZoomInCommand,
            callback: this.zoomIn,
            priority: 119,
            text: "$(pdfjs-reader-zoom-in)"
        });

        this.zoomOutStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.selectZoomOutCommand,
            callback: this.zoomOut,
            priority: 121,
            text: "$(pdfjs-reader-zoom-out)"
        });
    }

    private static readonly zoomModes: Array<vscode.QuickPickItem & { mode: ZoomMode }> = [
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
        { mode: -1, label: "Custom" }
    ];


    private async selectZoomMode() {
        if (this.presenters.active) {
            const selected = await vscode.window.showQuickPick(PdfProvider.zoomModes, { title: "Zoom Mode" });
            if (selected) {
                if (selected.mode) {
                    if (selected.mode != -1) {
                        this.presenters.active.postMessage('view', { zoomMode: { scale: selected.mode } });
                    } else {
                        const custom = Number(await vscode.window.showInputBox({ title: "Custom Zoom" })) / 100;
                        if (!isNaN(custom)) {
                            this.presenters.active.postMessage('view', { zoomMode: { scale: custom } });
                        }
                    }
                }
            }
        }
    }

    private updateZoomMode(mode: ZoomMode) {
        const selected = PdfProvider.zoomModes.find(m => m.mode == mode);
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
        this.presenters.active?.postMessage('view', { zoomMode: { steps: +1 } });
    }

    private zoomOut() {
        this.presenters.active?.postMessage('view', { zoomMode: { steps: -1 } });
    }

    private rotationStatusBarItem!: vscode.StatusBarItem;

    private static readonly rotateLeftCommand = "pdfjsReader.rotateLeft";
    private rotateLeftStatusBarItem!: vscode.StatusBarItem;

    private static readonly rotateRightCommand = "pdfjsReader.rotateRight";
    private rotateRightStatusBarItem!: vscode.StatusBarItem;

    private registerRotation() {
        this.rotationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
        this.rotationStatusBarItem.text = "Rotation";
        this._context.subscriptions.push(this.rotationStatusBarItem);

        this.rotateLeftStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.rotateLeftCommand,
            callback: this.rotateLeft,
            priority: 111,
            text: "$(pdfjs-reader-rotate-left)"
        });

        this.rotateRightStatusBarItem = this.registerStatusBarItem({
            command: PdfProvider.rotateRightCommand,
            callback: this.rotateRight,
            priority: 109,
            text: "$(pdfjs-reader-rotate-right)"
        });
    }

    private updateRotation(pagesRotation: number) {
        this.rotationStatusBarItem.text = `${pagesRotation} °`;

        this.rotationStatusBarItem.show();
        this.rotateLeftStatusBarItem.show();
        this.rotateRightStatusBarItem.show();
    }

    private rotateLeft() {
        this.presenters.active?.postMessage('view', { pagesRotation: { delta: -90 } });
    }

    private rotateRight() {
        this.presenters.active?.postMessage('view', { pagesRotation: { delta: +90 } });
    }
}
