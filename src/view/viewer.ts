import { VscodeTree } from "@vscode-elements/elements/dist/vscode-tree/index.js";

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

export class Viewer {
    private readonly eventBus: pdfjsViewer.EventBus;
    private readonly linkService: pdfjsViewer.PDFLinkService;
    private readonly findController: pdfjsViewer.PDFFindController;
    private readonly scriptingManager: pdfjsViewer.PDFScriptingManager;
    private readonly history: pdfjsViewer.PDFHistory;
    private readonly pdfViewer: pdfjsViewer.PDFViewer;
    private readonly container: HTMLDivElement;
    private readonly viewerPane: HTMLDivElement;
    private readonly outlinePane: OutlinePane;

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

        this.container = document.getElementById("viewerContainer") as HTMLDivElement;

        this.pdfViewer = new pdfjsViewer.PDFViewer({
            container: this.container,
            eventBus: this.eventBus,
            linkService: this.linkService,
            findController: this.findController,
            scriptingManager: this.scriptingManager,
        });

        this.linkService.setViewer(this.pdfViewer);
        this.linkService.setHistory(this.history);
        this.scriptingManager.setViewer(this.pdfViewer);

        this.viewerPane = document.getElementById("viewerPane") as HTMLDivElement;
        new ResizeObserver(this.onResize.bind(this)).observe(this.viewerPane);

        this.outlinePane = new OutlinePane({
            outlinePane: document.getElementById("outlinePane") as HTMLDivElement,
            pdfViewer: this.pdfViewer,
            linkService: this.linkService
        });
    }

    public async load({ document }: { document: { url: string } }) {
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
    }

    public save() {
        return this.pdfViewer.pdfDocument?.saveDocument();
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

    public on(eventName: string, listener: Function, options?: Object) {
        this.eventBus.on(eventName, listener, options);
    }

    public off(eventName: string, listener: Function, options?: Object) {
        this.eventBus.off(eventName, listener, options)
    }

    private onResize() {
        const rect = this.viewerPane.getBoundingClientRect();
        this.container.style.left = `${rect.left}px`;
        this.container.style.width = `${rect.width}px`;

        if (this.pdfViewer.currentScaleValue) {
            this.pdfViewer.currentScaleValue = this.pdfViewer.currentScaleValue;
        }
    }
}

class OutlinePane {
    private readonly outlinePane: HTMLDivElement;
    private readonly outlineTree: VscodeTree;
    private readonly pdfViewer: pdfjsViewer.PDFViewer;
    private readonly linkService: pdfjsViewer.PDFLinkService;

    constructor({
        outlinePane,
        pdfViewer,
        linkService
    }: {
        outlinePane: HTMLDivElement;
        pdfViewer: pdfjsViewer.PDFViewer;
        linkService: pdfjsViewer.PDFLinkService;
    }) {
        this.outlinePane = outlinePane;
        this.outlineTree = outlinePane.querySelector('vscode-tree')!;
        this.pdfViewer = pdfViewer;
        this.linkService = linkService;

        this.outlineTree.addEventListener('vsc-tree-select', ({ detail }) => {
            this.linkService.setHash(detail.value.substring(1));
        });
    }

    async setDocument(pdfDocument?: pdfjsLib.PDFDocumentProxy) {
        if (pdfDocument) {
            type OutlineItem = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>>[number];
            type TreeItem = VscodeTree['data'][number];

            const makeOutline = (outline: OutlineItem[]): TreeItem[] =>
                outline.map(item => ({
                    label: item.title,
                    value: item.dest ? this.linkService.getDestinationHash(item.dest) : undefined,
                    subItems: item.items ? makeOutline(item.items) : undefined
                }));

            const outline = await pdfDocument.getOutline();
            this.outlineTree.data = makeOutline(outline);
        } else {
            this.outlineTree.data = [];
        }
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
