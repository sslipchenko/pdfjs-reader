import { VscodeSplitLayout } from "@vscode-elements/elements/dist/main.js";
import { OutlinePane } from "./outline.js";
import { FindOptions, FindPane } from "./find.js";
import { AnnotationManager } from "./annotations.js"

const CMAP_URL = "./cmaps/";
const CMAP_PACKED = true;

const ENABLE_XFA = true;

const SANDBOX_BUNDLE_SRC = new URL("./build/pdf.sandbox.mjs", document.baseURI);

const DEFAULT_SCALE_VALUE = "auto";
const DEFAULT_SCALE = 1.0;
const DEFAULT_SCALE_DELTA = 1.1;

if (!pdfjsLib.getDocument || !pdfjsViewer.PDFViewer) {
    throw new Error("Unable to detect PDF.js libraries");
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";

export interface LoadConfig {
    document: { url: string };
    defaults: {
        pageNumber?: number;
        zoomMode?: string;
        scrollMode?: string;
        spreadMode?: string;
        outlineSize?: string;
    }
}

export class Viewer {
    private readonly eventBus: pdfjsViewer.EventBus;
    private readonly linkService: pdfjsViewer.PDFLinkService;
    private readonly findController: pdfjsViewer.PDFFindController;
    private readonly scriptingManager: pdfjsViewer.PDFScriptingManager;
    private readonly history: pdfjsViewer.PDFHistory;
    private readonly pdfViewer: pdfjsViewer.PDFViewer;
    private readonly container: HTMLDivElement;
    private readonly outlineSplit: VscodeSplitLayout;
    private readonly viewerPane: HTMLDivElement;
    private readonly outlinePane: OutlinePane;
    private readonly findPane: FindPane;
    private readonly annotationManager: AnnotationManager;

    constructor() {
        this.eventBus = new pdfjsViewer.EventBus();

        this.linkService = new pdfjsViewer.PDFLinkService({
            eventBus: this.eventBus
        });

        this.scriptingManager = new pdfjsViewer.PDFScriptingManager({
            eventBus: this.eventBus,
            sandboxBundleSrc: SANDBOX_BUNDLE_SRC,
        });

        this.history = new pdfjsViewer.PDFHistory({
            eventBus: this.eventBus,
            linkService: this.linkService
        });

        this.findController = new pdfjsViewer.PDFFindController({
            eventBus: this.eventBus,
            linkService: this.linkService
        });

        this.annotationManager = new AnnotationManager({
            eventBus: this.eventBus
        });

        this.container = document.getElementById("viewerContainer") as HTMLDivElement;

        this.pdfViewer = new pdfjsViewer.PDFViewer({
            container: this.container,
            eventBus: this.eventBus,
            linkService: this.linkService,
            findController: this.findController,
            scriptingManager: this.scriptingManager,
            annotationEditorHighlightColors: document.querySelector<HTMLMetaElement>("meta[name='highlightColors']")!.content
        });

        this.linkService.setViewer(this.pdfViewer);
        this.linkService.setHistory(this.history);
        this.scriptingManager.setViewer(this.pdfViewer);
        this.annotationManager.setViewer(this.pdfViewer);

        this.outlineSplit = document.getElementById("outlineSplit") as VscodeSplitLayout;
        this.outlineSplit['_handleMouseMove'] = patchedHandleMouseMove.bind(this.outlineSplit);

        this.outlineSplit.addEventListener("vsc-split-layout-change", ({ detail }) => {
            this.outlineSplit.handlePosition = `${detail.position}px`;
        });

        this.viewerPane = document.getElementById("viewerPane") as HTMLDivElement;
        new ResizeObserver(this.onResize.bind(this)).observe(this.viewerPane);

        this.outlinePane = new OutlinePane({
            outlinePane: document.getElementById("outlinePane") as HTMLDivElement,
            eventBus: this.eventBus,
            pdfViewer: this.pdfViewer,
            linkService: this.linkService
        });

        this.findPane = new FindPane({
            findPane: document.getElementById("findPane") as HTMLDivElement,
            eventBus: this.eventBus
        });
        window.addEventListener("keydown", ({ key }) => {
            if (key == 'Escape') {
                this.findPane.close();
            }
        });
    }

    public async load({ document, defaults }: LoadConfig) {
        const pdf = await pdfjsLib.getDocument({
            ...document,
            cMapUrl: CMAP_URL,
            cMapPacked: CMAP_PACKED,
            enableXfa: ENABLE_XFA
        }).promise;
        pdf._pdfInfo.fingerprints = [document.url];

        this.pdfViewer.setDocument(pdf);
        this.linkService.setDocument(pdf, null);
        this.outlinePane.setDocument(pdf);

        this.history.initialize({ fingerprint: document.url });

        this.outlineSplit.style.display = "";
        this.outlineSize = defaults.outlineSize ?? '100px';

        this.eventBus.on('pagesloaded', () => {
            if (defaults.pageNumber) {
                this.currentPageNumber = defaults.pageNumber;
            }

            if (defaults.zoomMode) {
                this.zoomMode = defaults.zoomMode;
            }

            if (defaults.scrollMode) {
                this.scrollMode = defaults.scrollMode;
            }

            if (defaults.spreadMode) {
                this.spreadMode = defaults.spreadMode;
            }
        }, { once: true });
    }

    public save() {
        return this.pdfViewer.pdfDocument?.saveDocument();
    }

    public find(query: string, options: FindOptions) {
        this.findPane.show(query, options);
    }

    private _outlineSize!: string;

    public get outlineSize() {
        return this._outlineSize;
    }

    public set outlineSize(size: string) {
        if (this._outlineSize !== size) {
            if (size.startsWith('-')) {
                this.outlineSplit.handlePosition = '0px';
                this.outlinePane.hide();
            } else {
                this.outlineSplit.handlePosition = size;
                this.outlinePane.show();
            }

            if (this._outlineSize) {
                this._outlineSize = size;
                this.eventBus.dispatch('outlinelayoutchanged', {});
            } else {
                this._outlineSize = size;
            }
        }
    }

    public get spreadMode() {
        return SPREAD.getName(this.pdfViewer.spreadMode);
    }

    public set spreadMode(name: string) {
        this.pdfViewer.spreadMode = SPREAD.getMode(name);
    }

    public get scrollMode() {
        return SCROLL.getName(this.pdfViewer.scrollMode);
    }

    public set scrollMode(name: string) {
        this.pdfViewer.scrollMode = SCROLL.getMode(name);
    }

    public get zoomMode() {
        return this.pdfViewer.currentScaleValue;
    }

    public set zoomMode(zoom: string) {
        this.pdfViewer.currentScaleValue = zoom;
    }

    public updateZoomMode(steps: number) {
        this.pdfViewer.updateScale({ steps });
    }

    public get rotation() {
        return this.pdfViewer.pagesRotation;
    }

    public set rotation(rotation: number) {
        this.pdfViewer.pagesRotation = rotation;
    }

    public get currentPageNumber() {
        return this.pdfViewer.currentPageNumber;
    }

    public set currentPageNumber(page: number) {
        this.pdfViewer.currentPageNumber = page;
    }

    public get totalPageNumber() {
        return this.pdfViewer.pdfDocument?.numPages;
    }

    public navigate(action: string) {
        this.linkService.executeNamedAction(action);
    }

    public highlight(color: string | undefined) {
        this.annotationManager.highlight(color);
    }

    public on(eventName: string, listener: Function, options?: Object) {
        this.eventBus.on(eventName, listener, options);
    }

    public off(eventName: string, listener: Function, options?: Object) {
        this.eventBus.off(eventName, listener, options)
    }

    private onResize() {
        const rect = this.viewerPane.getBoundingClientRect();
        this.container.style.top = `${rect.top}px`;
        this.container.style.left = `${rect.left}px`;
        this.container.style.width = `${rect.width}px`;
        this.container.style.height = `${rect.height}px`;

        if (this.pdfViewer.currentScaleValue) {
            this.pdfViewer.currentScaleValue = this.pdfViewer.currentScaleValue;
        }
    }
}

function patchedHandleMouseMove(this: any, event: MouseEvent) {
    const { clientX, clientY } = event;
    const { left, top, height, width } = this._boundRect;
    const vert = this.split === 'vertical';
    const maxPos = vert ? width : height;
    const mousePos = vert ? clientX - left : clientY - top;

    this._handlePosition = Math.max(
        100,
        Math.min(mousePos - this._handleOffset + this.handleSize / 2, maxPos)
    );

    if (this.fixedPane === 'start') {
        this._fixedPaneSize = this._handlePosition;
    }

    if (this.fixedPane === 'end') {
        this._fixedPaneSize = maxPos - this._handlePosition;
    }
}

class ModeName {
    private readonly modeToName: Record<number, string>;

    constructor(private readonly nameToMode: Record<string, number>) {
        this.modeToName = {};
        for (const key in nameToMode) {
            this.modeToName[nameToMode[key]] = key;
        }
    }

    getName(mode: number) {
        return this.modeToName[mode];
    }

    getMode(name: string) {
        return this.nameToMode[name] ?? -1;
    }
}

const SPREAD = new ModeName({
    'none': 0,
    'odd': 1,
    'even': 2
});

const SCROLL = new ModeName({
    'vertical': 0,
    'horizontal': 1,
    'wrapped': 2,
    'page': 3
});
