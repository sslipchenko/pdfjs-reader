import { VscodeTree } from "@vscode-elements/elements/dist/main.js";

export class OutlinePane {
    private readonly outlinePane: HTMLDivElement;
    private readonly outlineTree: VscodeTree;
    private readonly eventBus: pdfjsViewer.EventBus;
    private readonly pdfViewer: pdfjsViewer.PDFViewer;
    private readonly linkService: pdfjsViewer.PDFLinkService;

    constructor({
        outlinePane,
        eventBus,
        pdfViewer,
        linkService
    }: {
        outlinePane: HTMLDivElement;
        eventBus: pdfjsViewer.EventBus;
        pdfViewer: pdfjsViewer.PDFViewer;
        linkService: pdfjsViewer.PDFLinkService;
    }) {
        this.outlinePane = outlinePane;
        this.outlineTree = outlinePane.querySelector('vscode-tree')!;
        this.eventBus = eventBus;
        this.pdfViewer = pdfViewer;
        this.linkService = linkService;

        this.outlineTree.addEventListener('vsc-tree-select', ({ detail }) =>
            this.navigate(detail.value));

        this.eventBus.on("pagechanging", (data: { pageNumber: number }) =>
            this.onPageChanging(data));
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

        this._destHashToPageNumber = undefined;
    }

    private navigate(hash: string) {
        this.linkService.goToDestination(JSON.parse(unescape(hash.substring(1))));
    }

    private _destHashToPageNumber: Map<string, number> | undefined;

    private async onPageChanging({ pageNumber }: { pageNumber: number }) {
        const destHashToPageNumber = await this.getDestHashToPageNumber();

        type TreeItem = VscodeTree['data'][number];
        const hasSelectedItem = (items: TreeItem[]) =>
            items && items.some(item => item.selected);

        const updateSelected = (items: TreeItem[]) =>
            items.map((item): TreeItem => {
                const selected = destHashToPageNumber.get(item.value!) === pageNumber;
                const subItems = item.subItems ? updateSelected(item.subItems) : undefined;

                return {
                    ...item,
                    selected,
                    subItems,
                    hasSelectedItem: subItems !== undefined && hasSelectedItem(subItems)
                }
            });

        this.outlineTree.data = updateSelected(this.outlineTree.data);
    }

    private async getDestHashToPageNumber() {
        if (!this._destHashToPageNumber) {
            this._destHashToPageNumber = new Map();

            if (this.outlineTree.data) {
                const queue = [this.outlineTree.data];
                while (queue.length > 0) {
                    const items = queue.shift()!;

                    for (const { value: hash, subItems } of items) {
                        const parsed = JSON.parse(unescape(hash!.substring(1)));
                        const explicit = typeof parsed === 'string'
                            ? await this.pdfViewer.pdfDocument!.getDestination(parsed)
                            : parsed;

                        if (Array.isArray(explicit)) {
                            const [ref] = explicit;

                            let pageNumber;
                            if (ref && typeof ref === 'object') {
                                pageNumber = this.pdfViewer.pdfDocument!.cachedPageNumber(ref);
                            } else if (Number.isInteger(ref)) {
                                pageNumber = ref + 1;
                            }

                            if (Number.isInteger(pageNumber)) {
                                this._destHashToPageNumber.set(hash!, pageNumber);
                            }
                        }

                        if (subItems?.length) {
                            queue.push(subItems);
                        }
                    }
                }
            }
        }

        return this._destHashToPageNumber;
    }
}
