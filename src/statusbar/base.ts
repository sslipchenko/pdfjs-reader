import * as vscode from 'vscode';
import { PdfPresenter, Status } from '../presenter';

export abstract class BaseStatusBarItems {
    protected presenter: PdfPresenter | undefined;

    constructor(protected readonly _context: vscode.ExtensionContext) { }

    protected registerStatusBarItem({
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

    show(presenter: PdfPresenter): void {
        this.presenter = presenter;
    }

    abstract hide(): void;
}
