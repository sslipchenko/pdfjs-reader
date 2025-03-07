import { Viewer, LoadConfig } from "./viewer.js";

const vscode = acquireVsCodeApi();

const viewer = new Viewer();

const postStatus = (body: any) => vscode.postMessage({ type: 'status', body });

viewer.on("find", ({
   query,
   highlightAll,
   caseSensitive,
   entireWord,
   matchDiacritics
}: {
   query: string
   highlightAll?: boolean;
   caseSensitive?: boolean;
   entireWord?: boolean;
   matchDiacritics?: boolean;
}) => vscode.postMessage({ type: 'find', body: { query, options: { highlightAll, caseSensitive, entireWord, matchDiacritics } } }));
viewer.on("outlinelayoutchanged", () => postStatus({ outlineSize: viewer.outlineSize }));
viewer.on("scrollmodechanged", () => postStatus({ scrollMode: viewer.scrollMode }));
viewer.on("spreadmodechanged", () => postStatus({ spreadMode: viewer.spreadMode }));
viewer.on("scalechanging", () => postStatus({ zoomMode: viewer.zoomMode }));
viewer.on("rotationchanging", () => postStatus({ pagesRotation: viewer.rotation }));
viewer.on("pagechanging", () => postStatus({ pages: { current: viewer.currentPageNumber, total: viewer.totalPageNumber } }));

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
      case 'toggle':
         onToggle(body);
         break;
      case 'find':
         onFind(body);
         break;
      case 'navigate':
         onNavigate(body);
         break;
      case 'status':
         onStatus();
         break;
   }
});

const onOpen = async (config: LoadConfig) => {
   await onReload(config);

   onStatus();
}

const onReload = (config: LoadConfig) => viewer.load(config);

const onSave = async (requestId: any) => {
   const data = await viewer.save();
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
      viewer.spreadMode = spreadMode;
   }

   if (scrollMode) {
      viewer.scrollMode = scrollMode;
   }

   if (zoomMode) {
      if (zoomMode.steps) {
         viewer.updateZoomMode(zoomMode.steps);
      } else if (zoomMode.scale) {
         viewer.zoomMode = zoomMode.scale;
      }
   }

   if (pagesRotation) {
      if (pagesRotation.delta) {
         viewer.rotation += pagesRotation.delta;
      }
   }
}

const onToggle = (options: { sidebar?: 'outline'}) => {
   switch(options.sidebar) {
      case 'outline':
         viewer.outlineSize = `${-parseInt(viewer.outlineSize)}px`;
         break;
   }
}

const onFind = ({
   query,
   options
}: {
   query: string;
   options: {
      highlightAll?: boolean;
      matchCase?: boolean;
      matchDiacritics?: boolean;
      matchWholeWords?: boolean;
   }
}) => {
   viewer.find(query, options);
}

const onNavigate = ({
   page,
   action
}: {
   page?: number;
   action?: string
}) => {
   if (page) {
      viewer.currentPageNumber = page;
   } else if (action) {
      switch (action) {
         case 'first':
            viewer.currentPageNumber = 1;
            break;
         case 'prev':
            viewer.currentPageNumber = Math.max(viewer.currentPageNumber - 1, 1);
            break;
         case 'next':
            viewer.currentPageNumber = Math.min(viewer.currentPageNumber + 1, viewer.totalPageNumber ?? 0);
            break;
         case 'last':
            viewer.currentPageNumber = viewer.totalPageNumber ?? 0;
            break;
         default:
            viewer.navigate(action);
      }
   }
}

const onStatus = () => {
   const status = {
      spreadMode: viewer.spreadMode,
      scrollMode: viewer.scrollMode,
      zoomMode: viewer.zoomMode || 'auto',
      pagesRotation: viewer.rotation,
      pages: {
         current: viewer.currentPageNumber,
         total: viewer.totalPageNumber
      }
   }

   vscode.postMessage({ type: 'status', body: status });
}
