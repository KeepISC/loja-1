// The dedicated build mode cannot be enabled by a query parameter or browser storage.
export const isDemo = import.meta.env?.MODE === 'pages';
export const basePath = import.meta.env?.BASE_URL ?? '/';
