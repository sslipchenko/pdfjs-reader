import path from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { PdfDocument } from './document';
import { PdfPresenter, PdfPresenterCollection, Status } from './presenter';
import { NavigationStatusBarItems, ZoomStatusBarItems, RotationStatusBarItems, SpreadStatusBarItems, ScrollStatusBarItems } from './statusbar';

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

    private navigationStatusBarItems: NavigationStatusBarItems;
    private zoomStatusBarItems: ZoomStatusBarItems;
    private rotationStatusBarItems: RotationStatusBarItems;
    private spreadStatusBarItems: SpreadStatusBarItems;
    private scrollStatusBarItems: ScrollStatusBarItems;

    constructor(private readonly _context: vscode.ExtensionContext) {
        const presenter = () => this.presenters.active;
        this.navigationStatusBarItems = new NavigationStatusBarItems(_context, presenter);
        this.zoomStatusBarItems = new ZoomStatusBarItems(_context, presenter);
        this.rotationStatusBarItems = new RotationStatusBarItems(_context, presenter);
        this.spreadStatusBarItems = new SpreadStatusBarItems(_context, presenter);
        this.scrollStatusBarItems = new ScrollStatusBarItems(_context, presenter);
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
                vscode.Uri.joinPath(this._context.extensionUri, 'lib'),
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

    private updateStatusBar({ status }: {
        readonly presenter: PdfPresenter;
        readonly status?: Status;
    }) {
        if (status) {
            this.navigationStatusBarItems.show(status);
            this.zoomStatusBarItems.show(status);
            this.rotationStatusBarItems.show(status);
            this.spreadStatusBarItems.show(status);
            this.scrollStatusBarItems.show(status);
        }

        if (!this.presenters.active) {
            this.navigationStatusBarItems.hide();
            this.zoomStatusBarItems.hide();
            this.rotationStatusBarItems.hide();
            this.spreadStatusBarItems.hide();
            this.scrollStatusBarItems.hide();
        }
    }
}
