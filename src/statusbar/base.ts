import * as vscode from 'vscode';
import { PdfPresenter, Status } from '../presenter';

export type PdfPresenterDelegate = () => PdfPresenter | undefined

export abstract class BaseStatusBarItems {
    constructor(
        protected readonly _context: vscode.ExtensionContext,
        protected readonly _presenter: PdfPresenterDelegate) { }

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

    abstract show(status: Status): void;
    abstract hide(): void;
}
