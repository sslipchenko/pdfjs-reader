import path, { resolve } from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { PdfDocument } from './document';
import { PdfPresenter, PdfPresenterCollection, Status } from './presenter';
import { NavigationStatusBarItems, ZoomStatusBarItems, RotationStatusBarItems, SpreadStatusBarItems, ScrollStatusBarItems } from './statusbar';
import { ViewStatusBarItems } from './statusbar/view';

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

    private viewStatusBarItems: ViewStatusBarItems;
    private navigationStatusBarItems: NavigationStatusBarItems;
    private zoomStatusBarItems: ZoomStatusBarItems;
    private rotationStatusBarItems: RotationStatusBarItems;
    private spreadStatusBarItems: SpreadStatusBarItems;
    private scrollStatusBarItems: ScrollStatusBarItems;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this.viewStatusBarItems = new ViewStatusBarItems(_context);
        this.navigationStatusBarItems = new NavigationStatusBarItems(_context);
        this.zoomStatusBarItems = new ZoomStatusBarItems(_context);
        this.rotationStatusBarItems = new RotationStatusBarItems(_context);
        this.spreadStatusBarItems = new SpreadStatusBarItems(_context);
        this.scrollStatusBarItems = new ScrollStatusBarItems(_context);

        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.find",
            () => { this.presenters.active?.find(); }));

        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.highlightSelection",
            this.highlightSelection, this));
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
                const response = await presenter.save();
                return new Uint8Array(response);
            }
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChangeDocument(e => {
            for (const presenter of this.presenters.get(document.uri)) {
                if (e.force || !presenter.webviewPanel.active) {
                    presenter.reload(e.dataFile);
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
                this._context.extensionUri,
                document.dataFile.with({ path: path.dirname(document.dataFile.path) })
            ]
        };

        presenter.onDidChange(this.updateStatusBar, this);
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

    private updateStatusBar({ presenter }: { readonly presenter: PdfPresenter; }) {
        if (presenter.status) {
            this.viewStatusBarItems.show(presenter);
            this.navigationStatusBarItems.show(presenter);
            this.zoomStatusBarItems.show(presenter);
            this.rotationStatusBarItems.show(presenter);
            this.spreadStatusBarItems.show(presenter);
            this.scrollStatusBarItems.show(presenter);
        }

        if (!this.presenters.active) {
            this.viewStatusBarItems.hide();
            this.navigationStatusBarItems.hide();
            this.zoomStatusBarItems.hide();
            this.rotationStatusBarItems.hide();
            this.spreadStatusBarItems.hide();
            this.scrollStatusBarItems.hide();
        }
    }

    private async highlightSelection() {
        if (this.presenters.active) {
            const selected = await this.showColorPick("Highlight",
                this._context.workspaceState.get<string>("pdfjs-reader.highlight"));
            if (selected) {
                const palette = vscode.workspace.getConfiguration("pdfjsReader.viewer")
                    .get<Record<string, string>>("highlightColors");
                this.presenters.active.highlight(selected.id ? palette![selected.id] : undefined);
                this._context.workspaceState.update("pdfjs-reader.highlight", selected.id);
            }
        }
    }

    private async showColorPick(title: string, recent: string | undefined) {
        const iconPath = (color: string): vscode.IconPath => {
            const uri = vscode.Uri.joinPath(this._context.extensionUri, 'icons', 'highlight', `${color}.svg`);
            return { dark: uri, light: uri };
        }

        const colorItems: Array<vscode.QuickPickItem & { id: string | undefined }> = [
            { id: 'yellow', label: 'Yellow', iconPath: iconPath('yellow') },
            { id: 'green', label: 'Green', iconPath: iconPath('green') },
            { id: 'blue', label: 'Blue', iconPath: iconPath('blue') },
            { id: 'pink', label: 'Pink', iconPath: iconPath('pink') },
            { id: 'red', label: 'Red', iconPath: iconPath('red') },
            { id: undefined, label: 'None', iconPath: new vscode.ThemeIcon("circle-slash") }
        ];

        const disposables: vscode.Disposable[] = [];

        try {
            return await new Promise<(vscode.QuickPickItem & { id: string | undefined }) | undefined>((resolve) => {
                const recentItem = colorItems.find(i => i.id === recent);
                const colorPick = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string | undefined }>();
                colorPick.items = colorItems;
                colorPick.activeItems = recentItem ? [recentItem] : [];

                disposables.push(
                    colorPick.onDidChangeSelection(items => {
                        resolve(items[0]);
                        colorPick.hide();
                    }),
                    colorPick.onDidHide(() => {
                        resolve(undefined);
                        colorPick.dispose();
                    })
                );

                colorPick.show();
            })
        } finally {
            disposables.forEach(d => d.dispose());
        }


    }
}
