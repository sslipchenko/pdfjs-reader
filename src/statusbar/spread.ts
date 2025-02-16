import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter, SpreadMode, Status } from '../presenter';

export class SpreadStatusBarItems extends BaseStatusBarItems {
    private spreadModeStatusBarItem!: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.spreadModeStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.selectSpreadMode",
            callback: this.selectSpreadMode,
            priority: 100,
            text: "Spread Mode"
        })
    }

    show(presenter: PdfPresenter) {
        super.show(presenter);
        if (presenter.status?.spreadMode) {
            const mode = presenter.status?.spreadMode;
            const selected = SpreadStatusBarItems.spreadModes.find(m => m.mode == mode);
            if (selected) {
                this.spreadModeStatusBarItem.text = `$(${(selected.iconPath as vscode.ThemeIcon).id}) ${selected.label}`;
                this.spreadModeStatusBarItem.show();
            } else {
                this.spreadModeStatusBarItem.hide();
            }
        }
    }

    hide() {
        this.spreadModeStatusBarItem.hide();
    }

    private static readonly spreadModes: Array<vscode.QuickPickItem & { mode: SpreadMode }> = [
        { mode: 'none', label: "Single", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-none") },
        { mode: 'odd', label: "Odd", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") },
        { mode: 'even', label: "Even", iconPath: new vscode.ThemeIcon("pdfjs-reader-spread-odd") }
    ];

    private async selectSpreadMode() {
        if (this.presenter) {
            const selected = await vscode.window.showQuickPick(SpreadStatusBarItems.spreadModes, { title: "Spread Pages" });
            if (selected) {
                this.presenter.view({ spreadMode: selected.mode });
            }
        }
    }
}
