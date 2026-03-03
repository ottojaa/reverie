import type { ViewerProps } from '../viewer-registry';
import { ImageEditMode } from './ImageEditMode';
import { ImageViewMode } from './ImageViewMode';

export default function ImageViewer(props: ViewerProps) {
    if (props.isEditMode) return <ImageEditMode {...props} />;

    return <ImageViewMode {...props} />;
}
