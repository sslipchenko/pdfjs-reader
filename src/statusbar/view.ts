import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter } from '../presenter';

export class ViewStatusBarItems extends BaseStatusBarItems {
    private outlineStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.outlineStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.toggleOutline",
            callback: this.toggleOutline,
            priority: 140,
            text: "$(pdfjs-reader-view-outline)"
        });
    }

    show(presenter: PdfPresenter) {
        super.show(presenter);
        this.outlineStatusBarItem.show();
    }

    hide() {
        this.outlineStatusBarItem.hide();
    }

    private toggleOutline() {
        this.presenter?.toggle({ sidebar: 'outline' });
    }
}
