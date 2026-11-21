/** Float noise from the database must not flip a count at a threshold the slider sits exactly on. */
const EPSILON = 1e-6;

/** How many images reach `threshold`, given every candidate's best similarity, highest first (a binary search: the slider calls this on every move). */
export function countAtLeast(similaritiesDescending: number[], threshold: number): number {
    let low = 0;
    let high = similaritiesDescending.length;

    while (low < high) {
        const mid = (low + high) >> 1;

        if (similaritiesDescending[mid]! + EPSILON >= threshold) low = mid + 1;
        else high = mid;
    }

    return low;
}

export function formatThreshold(threshold: number): string {
    return threshold.toFixed(2);
}

/** "1 image" / "3 images". */
export function formatImageCount(count: number): string {
    return count === 1 ? '1 image' : `${count} images`;
}
