import { VscodeTree } from "@vscode-elements/elements/dist/vscode-tree/index.js";

const vscode = acquireVsCodeApi();

const CMAP_URL = "./cmaps/";
const CMAP_PACKED = true;

const ENABLE_XFA = true;

const SANDBOX_BUNDLE_SRC = new URL("./build/pdf.sandbox.mjs", window.location.href);

const DEFAULT_SCALE_VALUE = "auto";
const DEFAULT_SCALE = 1.0;
const DEFAULT_SCALE_DELTA = 1.1;

if (!pdfjsLib.getDocument || !pdfjsViewer.PDFViewer) {
   console.error("Unable to detect libraries");
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";

function makePdfViewer() {
   const eventBus = new pdfjsViewer.EventBus();

   const pdfLinkService = new pdfjsViewer.PDFLinkService({
      eventBus,
   });

   const pdfFindController = new pdfjsViewer.PDFFindController({
      eventBus,
      linkService: pdfLinkService,
   });

   const pdfScriptingManager = new pdfjsViewer.PDFScriptingManager({
      eventBus,
      sandboxBundleSrc: SANDBOX_BUNDLE_SRC,
   });

   const container = document.getElementById("viewerContainer") as HTMLDivElement;
   const viewer = document.getElementById("viewer") as HTMLDivElement;

   const pdfViewer = new pdfjsViewer.PDFViewer({
      container,
      viewer,
      eventBus,
      linkService: pdfLinkService,
      findController: pdfFindController,
      scriptingManager: pdfScriptingManager,
   });

   pdfLinkService.setViewer(pdfViewer);
   pdfScriptingManager.setViewer(pdfViewer);

   const viewerPane = document.getElementById("viewerPane") as HTMLDivElement;
   new ResizeObserver(() => {
      const rect = viewerPane.getBoundingClientRect();
      container.style.left = `${rect.left}px`;
      container.style.width = `${rect.width}px`;

      if (pdfViewer.currentScaleValue) {
         pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
      }
   }).observe(viewerPane);

   const postStatus = (body: any) => vscode.postMessage({ type: 'status', body });

   pdfViewer.eventBus.on("scrollmodechanged", () => postStatus({ scrollMode: SCROLL.getName(pdfViewer.scrollMode) }));
   pdfViewer.eventBus.on("spreadmodechanged", () => postStatus({ spreadMode: SPREAD.getName(pdfViewer.spreadMode) }));
   pdfViewer.eventBus.on("scalechanging", () => postStatus({ zoomMode: pdfViewer.currentScaleValue }));
   pdfViewer.eventBus.on("rotationchanging", () => postStatus({ pagesRotation: pdfViewer.pagesRotation }));
   pdfViewer.eventBus.on("pagechanging", () =>
      postStatus({
         pages: {
            current: pdfViewer.currentPageNumber,
            total: pdfViewer.pdfDocument?.numPages
         }
      }));

   return pdfViewer;
}

const pdfViewer = makePdfViewer();

type OutlineItem = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>>[number];
type TreeItem = VscodeTree['data'][number];

const makeOutline = (outline: OutlineItem[]): TreeItem[] => {
   return outline.map(item => ({
      label: item.title,
      // value: item.url,
      subItems: item.items ? makeOutline(item.items) : undefined
   }));
}

window.addEventListener("load", () => {
   vscode.postMessage({ type: 'ready' });
});

window.addEventListener('message', (e) => {
   const { type, body, requestId } = e.data;

   switch (type) {
      case 'open':
         onOpen(body)
         break;
      case 'reload':
         onReload(body);
         break;
      case 'save':
         onSave(requestId);
         break;
      case 'view':
         onView(body);
         break;
      case 'navigate':
         onNavigate(body);
         break;
      case 'status':
         onStatus();
         break;
   }
});

const onOpen = async (config: {
   document: { url: string }
}) => {
   await onReload(config);

   onStatus();
}

const onReload = async ({
   document
}: {
   document: { url: string }
}) => {
   const pdf = await pdfjsLib.getDocument({
      ...document,
      cMapUrl: CMAP_URL,
      cMapPacked: CMAP_PACKED,
      enableXfa: ENABLE_XFA
   }).promise;
   pdf._pdfInfo.fingerprints = [document.url];

   pdfViewer.setDocument(pdf);
   (pdfViewer.linkService as pdfjsViewer.PDFLinkService).setDocument(document, null);

   const outlineTree = window.document.getElementById("outlineTree") as VscodeTree;
   outlineTree.data = makeOutline(await pdf.getOutline());
}

const onSave = async (requestId: any) => {
   const data = await pdfViewer.pdfDocument?.saveDocument();
   vscode.postMessage({ type: 'response', requestId, body: data });
}

const onView = ({
   spreadMode,
   scrollMode,
   zoomMode,
   pagesRotation
}: {
   spreadMode?: string;
   scrollMode?: string;
   zoomMode?: { steps?: number; scale?: string };
   pagesRotation?: { delta?: number }
}) => {
   if (spreadMode) {
      pdfViewer.spreadMode = SPREAD.getMode(spreadMode);
   }

   if (scrollMode) {
      pdfViewer.scrollMode = SCROLL.getMode(scrollMode);
   }

   if (zoomMode) {
      if (zoomMode.steps) {
         pdfViewer.updateScale({ steps: zoomMode.steps });
      } else if (zoomMode.scale) {
         pdfViewer.currentScaleValue = zoomMode.scale;
      }
   }

   if (pagesRotation) {
      if (pagesRotation.delta) {
         pdfViewer.pagesRotation += pagesRotation.delta;
      }
   }
}

const onNavigate = ({
   page,
   action
}: {
   page?: number;
   action?: string
}) => {
   if (page) {
      pdfViewer.currentPageNumber = page;
   } else if (action) {
      switch (action) {
         case 'first':
            pdfViewer.currentPageNumber = 1;
            break;
         case 'prev':
            pdfViewer.currentPageNumber = Math.max(pdfViewer.currentPageNumber - 1, 1);
            break;
         case 'next':
            pdfViewer.currentPageNumber = Math.min(pdfViewer.currentPageNumber + 1, pdfViewer.pdfDocument?.numPages ?? 0);
            break;
         case 'last':
            pdfViewer.currentPageNumber = pdfViewer.pdfDocument?.numPages ?? 0;
            break;
         default:
            pdfViewer.linkService.executeNamedAction(action);
      }
   }
}

const onStatus = () => {
   const status = {
      spreadMode: SPREAD.getName(pdfViewer.spreadMode),
      scrollMode: SCROLL.getName(pdfViewer.scrollMode),
      zoomMode: pdfViewer.currentScaleValue || DEFAULT_SCALE_VALUE,
      pagesRotation: pdfViewer.pagesRotation,
      pages: {
         current: pdfViewer.currentPageNumber,
         total: pdfViewer.pdfDocument?.numPages
      }
   }

   vscode.postMessage({ type: 'status', body: status });
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
