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
    switch(mode) {
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

function onOpen(config, requestId) {
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
        onStatus(requestId);
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

function onStatus(requestId) {
    const status = {
        spreadMode: spreadModeToString(PDFViewerApplication.pdfViewer.spreadMode),
        scrollMode: scrollModeToString(PDFViewerApplication.pdfViewer.scrollMode),
        zoomMode: PDFViewerApplication.pdfViewer.currentScaleValue
    }

    vscode.postMessage({ type: 'response', requestId, body: status });
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
}

document.addEventListener("webviewerloaded", async () => {
    PDFViewerApplicationOptions.set('defaultUrl', '');
    PDFViewerApplication.isViewerEmbedded = false;
    vscode.postMessage({ type: 'ready' }); ``
});

window.addEventListener('message', (e) => {
    const { type, body, requestId } = e.data;

    switch (type) {
        case 'open':
            onOpen(body, requestId);
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
            onStatus(requestId);
            break;
    }
});
