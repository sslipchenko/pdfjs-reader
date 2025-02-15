import * as vscode from 'vscode';
import { BaseStatusBarItems, PdfPresenterDelegate } from "./base";
import { SpreadMode, Status } from '../presenter';

export class SpreadStatusBarItems extends BaseStatusBarItems {
    private spreadModeStatusBarItem!: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext, presenter: PdfPresenterDelegate) {
        super(context, presenter);

        this.spreadModeStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.selectSpreadMode",
            callback: this.selectSpreadMode,
            priority: 100,
            text: "Spread Mode"
        })
    }

    show(status: Status) {
        if (status.spreadMode) {
            const selected = SpreadStatusBarItems.spreadModes.find(m => m.mode == status.spreadMode);
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
        const presenter = this._presenter();
        if (presenter) {
            const selected = await vscode.window.showQuickPick(SpreadStatusBarItems.spreadModes, { title: "Spread Pages" });
            if (selected) {
                presenter.view({ spreadMode: selected.mode });
            }
        }
    }
}
