import * as vscode from 'vscode';
import { Disposable } from './dispose';

export interface PdfDocumentDelegate {
    getDocumentData(): Promise<Uint8Array>;
}

export class PdfDocument extends Disposable implements vscode.CustomDocument {
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
