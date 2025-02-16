import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter, ScrollMode, Status } from '../presenter';

export class ScrollStatusBarItems extends BaseStatusBarItems {
    private scrollModeStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.scrollModeStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.selectScrollMode",
            callback: this.selectScrollMode,
            priority: 100,
            text: "Scroll Mode"
        });
    }

    show(presenter: PdfPresenter) {
        super.show(presenter);
        if (presenter.status?.scrollMode) {
            const mode = presenter.status?.scrollMode;
            const selected = ScrollStatusBarItems.scrollModes.find(m => m.mode == mode);
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
        if (this.presenter) {
            const selected = await vscode.window.showQuickPick(ScrollStatusBarItems.scrollModes, { title: "Scroll Mode" });
            if (selected) {
                this.presenter.view({ scrollMode: selected.mode });
            }
        }
    }
}
