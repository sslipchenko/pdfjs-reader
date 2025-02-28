import { VscodeIcon, VscodeTextfield } from "@vscode-elements/elements/dist/main.js";

export interface FindOptions {
    highlightAll?: boolean;
    caseSensitive?: boolean;
    entireWord?: boolean;
    matchDiacritics?: boolean;
}

enum FindState {
    FOUND = 0,
    NOT_FOUND = 1,
    WRAPPED = 2,
    PENDING = 3,
};

const FIND_EVENTS: Record<keyof FindOptions, string> = {
    highlightAll: 'highlightallchange',
    caseSensitive: 'casesensitivitychange',
    entireWord: 'entirewordchange',
    matchDiacritics: 'diacriticmatchingchange'
};

export class FindPane {
    private readonly findPane: HTMLDivElement;
    private readonly eventBus: pdfjsViewer.EventBus;
    private readonly textField: VscodeTextfield;
    private readonly matchesField: HTMLSpanElement;

    private options: FindOptions = {};

    constructor({
        findPane,
        eventBus
    }: {
        findPane: HTMLDivElement;
        eventBus: pdfjsViewer.EventBus;
    }) {
        this.eventBus = eventBus;

        this.findPane = findPane;

        this.findPane.addEventListener("keydown", ({ key, shiftKey, target }) => {
            switch (key) {
                case 'Enter':
                    if (target === this.textField) {
                        this.dispatch("again", shiftKey);
                    }
                    break;
                case 'Escape':
                    this.close();
                    break;
            }

        });

        this.textField = this.findPane.querySelector<VscodeTextfield>("vscode-textfield")!;
        this.matchesField = this.findPane.querySelector<HTMLSpanElement>(".matches")!;

        this.findPane.querySelector(".button.close")!
            .addEventListener("click", () => { this.close(); });

        for (const option of Object.keys(FIND_EVENTS)) {
            this.findPane.querySelector(`.option.${option}`)!
                .addEventListener("click", () => { this.toggle(option as (keyof FindOptions)); });
        }

        this.findPane.querySelector(".button.prev")!
            .addEventListener("click", () => { this.dispatch('again', true); });
        this.findPane.querySelector(".button.next")!
            .addEventListener("click", () => { this.dispatch('again', false); });

        this.eventBus.on("updatefindcontrolstate", this.onUpdateState.bind(this));
        this.eventBus.on("updatefindmatchescount", this.onUpdateMatchesCount.bind(this));
    }

    show(query: string, options: FindOptions) {
        this.findPane.style.display = '';
        this.textField.value = query;
        this.textField.focus();
        this.options = options;
        for (const option of Object.keys(FIND_EVENTS)) {
            const element = this.findPane.querySelector<VscodeIcon>(`.option.${option}`);
            const key = option as keyof FindOptions;
            if (this.options[key]) {
                element!.classList.add('active');
            } else {
                element!.classList.remove('active');
            }
        }
    }

    close() {
        this.findPane.style.display = 'none';
    }

    private toggle(option: keyof FindOptions) {
        this.findPane.querySelector<VscodeIcon>(`.option.${option}`)!.classList.toggle('active');
        this.options[option] = !this.options[option];
        this.dispatch(FIND_EVENTS[option]);
    }

    private dispatch(type: string, findPrevious?: boolean) {
        this.eventBus.dispatch("find", {
            source: this,
            type,
            query: this.textField.value,
            highlightAll: this.options.highlightAll,
            caseSensitive: this.options.caseSensitive,
            entireWord: this.options.entireWord,
            matchDiacritics: this.options.matchDiacritics,
            findPrevious
        });
    }

    private onUpdateState({
        state,
        matchesCount
    }: {
        state: FindState;
        matchesCount: { current: number; total: number; };
    }) {
        switch(state) {
            case FindState.PENDING:
                this.matchesField.textContent = "Pending..."
                break;
            case FindState.NOT_FOUND:
            case FindState.FOUND:
            case FindState.WRAPPED:
                this.onUpdateMatchesCount({ matchesCount });
                break;
        }
    }

    private onUpdateMatchesCount({
        matchesCount
    }: {
        matchesCount: { current: number; total: number; };
    }) {
        if (matchesCount.total > 0) {
            this.matchesField.textContent = `${matchesCount.current} of ${matchesCount.total}`;
            this.matchesField.classList.remove('empty');
        } else {
            this.matchesField.textContent = "No results";
            this.matchesField.classList.add('empty');
        }
    }
}
