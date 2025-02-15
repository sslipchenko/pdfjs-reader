import * as vscode from 'vscode';
import { BaseStatusBarItems, PdfPresenterDelegate } from "./base";
import { Status, ZoomMode } from '../presenter';

export class ZoomStatusBarItems extends BaseStatusBarItems {
    private zoomModeStatusBarItem: vscode.StatusBarItem;
    private zoomInStatusBarItem: vscode.StatusBarItem;
    private zoomOutStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext, presenter: PdfPresenterDelegate) {
        super(context, presenter);

        this.zoomModeStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.selectZoomMode",
            callback: this.selectZoomMode,
            priority: 120,
            text: "Zoom Mode"
        });

        this.zoomInStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.zoomIn",
            callback: this.zoomIn,
            priority: 119,
            text: "$(pdfjs-reader-zoom-in)"
        });

        this.zoomOutStatusBarItem = this.registerStatusBarItem({
            command: "pdfjsReader.zoomOut",
            callback: this.zoomOut,
            priority: 121,
            text: "$(pdfjs-reader-zoom-out)"
        });
    }

    show(status: Status) {
        if (status.zoomMode) {
            let mode = status.zoomMode;
            const selected = ZoomStatusBarItems.zoomModes.find(m => m.mode == mode);
            if (selected) {
                this.zoomModeStatusBarItem.text = selected.label;
            } else if (!isNaN(mode = Number(mode))) {
                this.zoomModeStatusBarItem.text =
                    new Intl.NumberFormat('default', {
                        style: 'percent',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                    }).format(mode);
            }

            this.zoomModeStatusBarItem.show();
            this.zoomInStatusBarItem.show();
            this.zoomOutStatusBarItem.show();
        }
    }

    hide() {
        this.zoomModeStatusBarItem.hide();
        this.zoomInStatusBarItem.hide();
        this.zoomOutStatusBarItem.hide();
    }

    private static readonly zoomModes: Array<vscode.QuickPickItem & { mode: ZoomMode }> = [
        { mode: 'auto', label: "Automatic Zoom" },
        { mode: 'page-actual', label: "Actual Size" },
        { mode: 'page-width', label: "Page Width" },
        { mode: 'page-height', label: "Page Height" },
        { mode: 'page-fit', label: "Page Fit" },
        { mode: 0.5, label: "50%" },
        { mode: 0.75, label: "75%" },
        { mode: 1.0, label: "100%" },
        { mode: 1.25, label: "125%" },
        { mode: 1.5, label: "150%" },
        { mode: -1, label: "Custom" }
    ];

    private async selectZoomMode() {
        const presenter = this._presenter();
        if (presenter) {
            const selected = await vscode.window.showQuickPick(ZoomStatusBarItems.zoomModes, { title: "Zoom Mode" });
            if (selected) {
                if (selected.mode) {
                    if (selected.mode != -1) {
                        presenter.view({ zoomMode: { scale: selected.mode } });
                    } else {
                        const custom = Number(await vscode.window.showInputBox({ title: "Custom Zoom" })) / 100;
                        if (!isNaN(custom)) {
                            presenter.view({ zoomMode: { scale: custom } });
                        }
                    }
                }
            }
        }
    }

    private zoomIn() {
        this._presenter()?.view({ zoomMode: { steps: +1 } });
    }

    private zoomOut() {
        this._presenter()?.view({ zoomMode: { steps: -1 } });
    }
}
