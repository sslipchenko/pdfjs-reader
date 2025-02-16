import * as vscode from 'vscode';
import { BaseStatusBarItems } from "./base";
import { PdfPresenter, ZoomMode } from '../presenter';

export class ZoomStatusBarItems extends BaseStatusBarItems {
    private zoomModeStatusBarItem: vscode.StatusBarItem;
    private zoomInStatusBarItem: vscode.StatusBarItem;
    private zoomOutStatusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        super(context);

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

    show(presenter: PdfPresenter) {
        super.show(presenter);
        if (presenter.status?.zoomMode) {
            let mode = presenter.status.zoomMode;
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
        if (this.presenter) {
            const selected = await vscode.window.showQuickPick(ZoomStatusBarItems.zoomModes, { title: "Zoom Mode" });
            if (selected) {
                if (selected.mode) {
                    if (selected.mode != -1) {
                        this.presenter.view({ zoomMode: { scale: selected.mode } });
                    } else {
                        const custom = Number(await vscode.window.showInputBox({ title: "Custom Zoom" })) / 100;
                        if (!isNaN(custom)) {
                            this.presenter.view({ zoomMode: { scale: custom } });
                        }
                    }
                }
            }
        }
    }

    private zoomIn() {
        this.presenter?.view({ zoomMode: { steps: +1 } });
    }

    private zoomOut() {
        this.presenter?.view({ zoomMode: { steps: -1 } });
    }
}
