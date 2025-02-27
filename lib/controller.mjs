const vscode = acquireVsCodeApi();

const cursorTool = (name) => {
    switch (name) {
        case 'select':
            return 0;
        case 'hand':
            return 1;
        case 'zoom':
            return 2;
        default:
            return 0;
    }
}

const scrollModeFromString = (name) => {
    switch (name) {
        case 'vertical':
            return 0;
        case 'horizontal':
            return 1;
        case 'wrapped':
            return 2;
        case 'page':
            return 3;
        default:
            return -1;
    }
}

const scrollModeToString = (mode) => {
    switch (mode) {
        case 0:
            return 'vertical';
        case 1:
            return 'horizontal';
        case 2:
            return 'wrapped';
        case 3:
            return 'page';
        default:
            return undefined;
    }
}

const spreadModeFromString = (name) => {
    switch (name) {
        case 'none':
            return 0;
        case 'odd':
            return 1;
        case 'even':
            return 2;
        default:
            return -1;
    }
}

const spreadModeToString = (mode) => {
    switch (mode) {
        case 0:
            return 'none';
        case 1:
            return 'odd';
        case 2:
            return 'even';
        default:
            return undefined;
    }
}

function onOpen(config) {
    PDFViewerApplicationOptions.set('cMapUrl', config.cMapUrl);
    PDFViewerApplicationOptions.set('standardFontDataUrl', config.standardFontDataUrl);
    PDFViewerApplicationOptions.set('cursorToolOnLoad', cursorTool(config.defaults.cursor));
    PDFViewerApplicationOptions.set('scrollModeOnLoad', scrollModeFromString(config.defaults.scrollMode));
    PDFViewerApplicationOptions.set('spreadModeOnLoad', spreadModeFromString(config.defaults.spreadMode));
    PDFViewerApplicationOptions.set('defaultZoomValue', config.defaults.zoom || -1);
    // PDFViewerApplicationOptions.set('sidebarViewOnLoad', config.default.sidebarView || -1);

    PDFViewerApplication.open(config.document).then(async () => {
        const document = await pdfjsLib.getDocument(config.document).promise;
        document._pdfInfo.fingerprints = [config.document.url];

        const postStatus = (body) => vscode.postMessage({ type: 'status', body });

        PDFViewerApplication.pdfViewer.eventBus.on("scrollmodechanged", () =>
            postStatus({ scrollMode: scrollModeToString(PDFViewerApplication.pdfViewer.scrollMode) }));

        PDFViewerApplication.pdfViewer.eventBus.on("spreadmodechanged", () =>
            postStatus({ spreadMode: spreadModeToString(PDFViewerApplication.pdfViewer.spreadMode) }));

        PDFViewerApplication.pdfViewer.eventBus.on("scalechanging", () =>
            postStatus({ zoomMode: PDFViewerApplication.pdfViewer.currentScaleValue }));

        PDFViewerApplication.pdfViewer.eventBus.on("rotationchanging", () =>
            postStatus({ pagesRotation: PDFViewerApplication.pdfViewer.pagesRotation }));

        PDFViewerApplication.pdfViewer.eventBus.on("pagechanging", () =>
            postStatus({
                pages: {
                    current: PDFViewerApplication.pdfViewer.currentPageNumber,
                    total: PDFViewerApplication.pdfDocument.numPages
                }
            }));

        onStatus();
    });
}

function onSave(requestId) {
    PDFViewerApplication.pdfDocument.saveDocument().then((data) => {
        vscode.postMessage({ type: 'response', requestId, body: data });
    });
}

function onReload(config) {
    pdfjsLib.getDocument(config.document).promise.then((document) => {
        // document._pdfInfo.fingerprints = [config.document.url];
        PDFViewerApplication.load(document);
    });
}

function onNavigate(config) {
    if (config.page) {
        PDFViewerApplication.pdfViewer.currentPageNumber = config.page;
    } else {
        switch (config.action) {
            case 'first':
                PDFViewerApplication.pdfViewer.currentPageNumber = 1;
                break;
            case 'prev':
                PDFViewerApplication.pdfViewer.currentPageNumber =
                    Math.max(PDFViewerApplication.pdfViewer.currentPageNumber - 1, 1);
                break;
            case 'next':
                PDFViewerApplication.pdfViewer.currentPageNumber =
                    Math.min(PDFViewerApplication.pdfViewer.currentPageNumber + 1,
                        PDFViewerApplication.pdfDocument.numPages);
                break;
            case 'last':
                PDFViewerApplication.pdfViewer.currentPageNumber =
                    PDFViewerApplication.pdfDocument.numPages;
                break;
            default:
                PDFViewerApplication.pdfLinkService.executeNamedAction(config.action);
        }
    }
}

function onStatus() {
    const status = {
        spreadMode: spreadModeToString(PDFViewerApplication.pdfViewer.spreadMode),
        scrollMode: scrollModeToString(PDFViewerApplication.pdfViewer.scrollMode),
        zoomMode: PDFViewerApplication.pdfViewer.currentScaleValue,
        pagesRotation: PDFViewerApplication.pdfViewer.pagesRotation,
        pages: {
            current: PDFViewerApplication.pdfViewer.currentPageNumber,
            total: PDFViewerApplication.pdfDocument.numPages
        }
    }

    vscode.postMessage({ type: 'status', body: status });
}

function onView(config) {
    if (config.spreadMode) {
        PDFViewerApplication.pdfViewer.spreadMode = spreadModeFromString(config.spreadMode);
    }

    if (config.scrollMode) {
        PDFViewerApplication.pdfViewer.scrollMode = scrollModeFromString(config.scrollMode);
    }

    if (config.zoomMode) {
        if (config.zoomMode.steps) {
            PDFViewerApplication.pdfViewer.updateScale({ steps: config.zoomMode.steps });
        } else if (config.zoomMode.scale) {
            PDFViewerApplication.pdfViewer.currentScaleValue = config.zoomMode.scale;
        }
    }

    if (config.pagesRotation) {
        if (config.pagesRotation.delta) {
            PDFViewerApplication.pdfViewer.pagesRotation += config.pagesRotation.delta;
        }
    }
}

document.addEventListener("webviewerloaded", () => {
    PDFViewerApplicationOptions.set('defaultUrl', '');
    PDFViewerApplication.isViewerEmbedded = false;
    vscode.postMessage({ type: 'ready' });
});

window.addEventListener('message', (e) => {
    const { type, body, requestId } = e.data;

    switch (type) {
        case 'open':
            onOpen(body);
            break;
        case 'save':
            onSave(requestId);
            break;
        case 'reload':
            onReload(body);
            break;
        case 'navigate':
            onNavigate(body);
            break;
        case 'view':
            onView(body);
            break;
        case 'status':
            onStatus();
            break;
    }
});
