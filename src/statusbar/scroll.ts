import * as vscode from 'vscode';
import { BaseStatusBarItems, PdfPresenterDelegate } from "./base";
import { ScrollMode, Status } from '../presenter';

export class ScrollStatusBarItems extends BaseStatusBarItems {
    private scrollModeStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext, presenter: PdfPresenterDelegate) {
        super(context, presenter);

        this.scrollModeStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.selectScrollMode",
            callback: this.selectScrollMode,
            priority: 100,
            text: "Scroll Mode"
        });
    }

    show(status: Status) {
        if (status.scrollMode) {
            const selected = ScrollStatusBarItems.scrollModes.find(m => m.mode == status.scrollMode);
            if (selected) {
                this.scrollModeStatusBarItem.text = `$(${(selected.iconPath as vscode.ThemeIcon).id}) ${selected.label}`;
                this.scrollModeStatusBarItem.show();
            } else {
                this.scrollModeStatusBarItem.hide();
            }
        }
    }

    hide() {
        this.scrollModeStatusBarItem.hide();
    }

    private static readonly scrollModes: Array<vscode.QuickPickItem & { mode: ScrollMode }> = [
        { mode: 'page', label: "Page", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-page") },
        { mode: 'vertical', label: "Vertical", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-vertical") },
        { mode: 'horizontal', label: "Horizontal", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-horizontal") },
        { mode: 'wrapped', label: "Wrapped", iconPath: new vscode.ThemeIcon("pdfjs-reader-scroll-wrapped") }
    ];

    private async selectScrollMode() {
        const presenter = this._presenter();
        if (presenter) {
            const selected = await vscode.window.showQuickPick(ScrollStatusBarItems.scrollModes, { title: "Scroll Mode" });
            if (selected) {
                presenter.view({ scrollMode: selected.mode });
            }
        }
    }
}
