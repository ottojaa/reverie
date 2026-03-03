import type { ViewerProps } from '../viewer-registry';
import { VideoEditMode } from './VideoEditMode';
import { VideoViewMode } from './VideoViewMode';

export default function VideoViewer(props: ViewerProps) {
    if (props.isEditMode) return <VideoEditMode {...props} />;

    return <VideoViewMode {...props} />;
}
