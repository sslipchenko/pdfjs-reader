import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter } from '../presenter';

export class NavigationStatusBarItems extends BaseStatusBarItems {
    private goToPageStatusBarItem: vscode.StatusBarItem;
    private prevPageStatusBarItem: vscode.StatusBarItem;
    private nextPageStatusBarItem: vscode.StatusBarItem;
    private firstPageStatusBarItem: vscode.StatusBarItem;
    private lastPageStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goBack",
            this.goBack, this));
        this._context.subscriptions.push(vscode.commands.registerCommand("pdfjsReader.goForward",
            this.goForward, this));

        this.firstPageStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.firstPage",
            callback: this.firstPage,
            priority: 132,
            text: "$(pdfjs-reader-page-first)"
        });

        this.prevPageStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.prevPage",
            callback: this.prevPage,
            priority: 131,
            text: "$(pdfjs-reader-page-prev)"
        });

        this.goToPageStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.goToPage",
            callback: this.goToPage,
            priority: 130,
            text: "Go to Page"
        });

        this.nextPageStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.nextPage",
            callback: this.nextPage,
            priority: 129,
            text: "$(pdfjs-reader-page-next)"
        });

        this.lastPageStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.lastPage",
            callback: this.lastPage,
            priority: 128,
            text: "$(pdfjs-reader-page-last)"
        });
    }

    show(presenter: PdfPresenter) {
        super.show(presenter);
        if (presenter.status?.pages) {
            this.goToPageStatusBarItem.text = `${presenter.status.pages.current} of ${presenter.status.pages.total}`;

            this.firstPageStatusBarItem.show();
            this.prevPageStatusBarItem.show();
            this.goToPageStatusBarItem.show();
            this.nextPageStatusBarItem.show();
            this.lastPageStatusBarItem.show();
        }
    }

    hide() {
        this.firstPageStatusBarItem.hide();
        this.prevPageStatusBarItem.hide();
        this.goToPageStatusBarItem.hide();
        this.nextPageStatusBarItem.hide();
        this.lastPageStatusBarItem.hide();
    }

    private goBack() {
        this.presenter?.navigate({ action: 'GoBack' });
    }

    private goForward() {
        this.presenter?.navigate({ action: 'GoForward' });
    }

    private async goToPage() {
        if (this.presenter) {
            const page = await vscode.window.showInputBox({ title: "Go to Page" });
            if (page) {
                this.presenter.navigate({ page: Number(page) });
            }
        }
    }

    private nextPage() {
        this.presenter?.navigate({ action: 'next' });
    }

    private prevPage() {
        this.presenter?.navigate({ action: 'prev' });
    }

    private firstPage() {
        this.presenter?.navigate({ action: 'first' });
    }

    private lastPage() {
        this.presenter?.navigate({ action: 'last' });
    }
}
