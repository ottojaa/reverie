/** One line per OCR'd image, in every environment: how long each phase took. */
export function logOcrTimings(documentId: string, timings: Record<string, number>): void {
    console.info('[OCRService] process timings', JSON.stringify({ documentId, ...timings }));
}
