export class AnnotationManager {
    private readonly eventBus: pdfjsViewer.EventBus;
    private pdfViewer?: pdfjsViewer.PDFViewer;
    private uiManager?: pdfjsLib.AnnotationEditorUIManager;

    constructor({ eventBus }: { eventBus: pdfjsViewer.EventBus }) {
        this.eventBus = eventBus;

        this.eventBus.on("annotationeditoruimanager", ({ uiManager }: { uiManager: pdfjsLib.AnnotationEditorUIManager }) => {
            this.uiManager = uiManager;
        });
    }

    setViewer(pdfViewer?: pdfjsViewer.PDFViewer) {
        this.pdfViewer = pdfViewer;
    }

    highlight(color: string | undefined) {
        if (!this.pdfViewer) {
            return;
        }

        if (color) {
            this.eventBus.on('annotationeditormodechanged', () => {
                this.eventBus.dispatch('editingaction', { name: 'highlightSelection' });
                setTimeout(() => { this.pdfViewer!.annotationEditorMode = { mode: pdfjsLib.AnnotationEditorType.NONE }; }, 0)
            }, { once: true });

            this.setEditorParam(pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR, color);
            this.pdfViewer!.annotationEditorMode = { mode: pdfjsLib.AnnotationEditorType.HIGHLIGHT };
        } else {
            const selection = document.getSelection();
            if (this.uiManager && selection && !selection.isCollapsed) {
                const selectionBoxes = this.uiManager.getSelectionBoxes(this.getTextLayer());
                if (selectionBoxes) {
                    type Box = typeof selectionBoxes[number];

                    const isInside = (a: Box, b: Box) =>
                        b.x <= a.x + 1e-6 && (b.x + b.width) >= (a.x + a.width) - 1e-6 &&
                        b.y <= a.y + 1e-6 && (b.y + b.height) >= (a.y + a.height) - 1e-6;

                    for (const editor of this.uiManager.getEditors(this.pdfViewer.currentPageNumber - 1)) {
                        if (editor.editorType !== "highlight") {
                            continue;
                        }

                        const [pageWidth, pageHeight] = editor.pageDimensions;
                        const [pageX, pageY] = editor.pageTranslation;
                        const quadPoints: number[] = (editor.serialize() as any)['quadPoints'];

                        const editorBoxes: Box[] = [];
                        for (let i = 0; i < quadPoints.length; i += 8) {
                            editorBoxes.push({
                              x: (quadPoints[i] - pageX) / pageWidth,
                              y: 1 - (quadPoints[i + 1] - pageY) / pageHeight,
                              width: (quadPoints[i + 2] - quadPoints[i]) / pageWidth,
                              height: (quadPoints[i + 1] - quadPoints[i + 5]) / pageHeight,
                            });
                        }

                        if (editorBoxes.every(e => selectionBoxes.some(s => isInside(e, s)))) {
                            editor.remove();
                        }
                    }
                }
            }
        }
    }

    private setEditorParam(type: number, value: any) {
        this.eventBus.dispatch('switchannotationeditorparams', { type, value });
        this.eventBus.dispatch('annotationeditorparamschanged', { details: [[type, value]] });
    }

    private getTextLayer() {
        const selection = document.getSelection();
        if (selection && !selection.isCollapsed) {
            return ((selection.anchorNode!.nodeType === Node.TEXT_NODE
                ? selection.anchorNode!.parentElement
                : selection.anchorNode!) as HTMLElement)
                .closest(".textLayer") as HTMLElement;
        } else {
            return null;
        }
    }
}
