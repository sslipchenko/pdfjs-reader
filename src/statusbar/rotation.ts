import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter } from '../presenter';

export class RotationStatusBarItems extends BaseStatusBarItems {
    private rotationStatusBarItem: vscode.StatusBarItem;
    private rotateLeftStatusBarItem: vscode.StatusBarItem;
    private rotateRightStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.rotationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
        this.rotationStatusBarItem.text = "Rotation";
        this._context.subscriptions.push(this.rotationStatusBarItem);

        this.rotateLeftStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.rotateLeft",
            callback: this.rotateLeft,
            priority: 111,
            text: "$(pdfjs-reader-rotate-left)"
        });

        this.rotateRightStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.rotateRight",
            callback: this.rotateRight,
            priority: 109,
            text: "$(pdfjs-reader-rotate-right)"
        });
    }

    show(presenter: PdfPresenter) {
        super.show(presenter);
        if (presenter.status?.pagesRotation) {
            this.rotationStatusBarItem.text = `${presenter.status.pagesRotation} °`;

            this.rotationStatusBarItem.show();
            this.rotateLeftStatusBarItem.show();
            this.rotateRightStatusBarItem.show();
        }
    }

    hide() {
        this.rotationStatusBarItem.hide();
        this.rotateLeftStatusBarItem.hide();
        this.rotateRightStatusBarItem.hide();
    }

    private rotateLeft() {
        this.presenter?.view({ pagesRotation: { delta: -90 } });
    }

    private rotateRight() {
        this.presenter?.view({ pagesRotation: { delta: +90 } });
    }
}
