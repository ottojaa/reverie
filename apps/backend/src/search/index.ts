// Search module exports
export { parseQuery, validateQuery, stringifyQuery, resolveRelativeDate } from './query-parser';
export { buildSearchQuery, buildCountQuery, type SearchQueryOptions } from './query-builder';
export { applySearchFilters, applyTypesFilter, buildPrefixTsQuery, documentJoins, type FilterDimension } from './filter-application';
export {
    generateSnippet,
    generateSnippets,
    generateFilenameSnippet,
    generateSummarySnippet,
    stripHighlights,
    getHighlightPositions,
    type SnippetOptions,
} from './highlighter';
export { generateFacets } from './facets';
export { search, getFacetsOnly, suggest } from './search.service';
