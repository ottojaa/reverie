declare module '@tanstack/history' {
    // eslint-disable-next-line no-unused-vars -- declaration merging: the name must match the library's interface
    interface HistoryState {
        /** Set on the navigation from a dashboard card to its kind view: back then returns to the dashboard as it was. */
        fromBrowseDashboard?: boolean;
    }
}

export {};
