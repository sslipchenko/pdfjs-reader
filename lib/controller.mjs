const vscode = acquireVsCodeApi();

function onOpen(config) {
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

    const scrollMode = (name) => {
        switch (name) {
            case 'vertical':
                return 0
            case 'horizontal':
                return 1
            case 'wrapped':
                return 2
            default:
                return -1
        }
    }

    const spreadMode = (name) => {
        switch (name) {
            case 'none':
                return 0
            case 'odd':
                return 1
            case 'even':
                return 2
            default:
                return -1
        }
    }

    PDFViewerApplicationOptions.set('cMapUrl', config.cMapUrl);
    PDFViewerApplicationOptions.set('standardFontDataUrl', config.standardFontDataUrl);
    PDFViewerApplicationOptions.set('cursorToolOnLoad', cursorTool(config.defaults.cursor));
    PDFViewerApplicationOptions.set('scrollModeOnLoad', scrollMode(config.defaults.scrollMode));
    PDFViewerApplicationOptions.set('spreadModeOnLoad', spreadMode(config.defaults.spreadMode));
    PDFViewerApplicationOptions.set('defaultZoomValue', config.defaults.zoom || -1);
    // PDFViewerApplicationOptions.set('sidebarViewOnLoad', config.default.sidebarView || -1);

    PDFViewerApplication.open(config.document).then(async () => {
        const document = await pdfjsLib.getDocument(config.document).promise;
        document._pdfInfo.fingerprints = [config.document.url];
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
    PDFViewerApplication.pdfLinkService.executeNamedAction(config.action);
}

document.addEventListener("webviewerloaded", async () => {
    PDFViewerApplicationOptions.set('defaultUrl', '');
    PDFViewerApplication.isViewerEmbedded = false;
    vscode.postMessage({ type: 'ready' });``
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
    }
});
