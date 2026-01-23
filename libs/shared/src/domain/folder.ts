// Domain types for folders

export interface FolderTreeNode {
  id: string
  name: string
  path: string
  description: string | null
  children: FolderTreeNode[]
  document_count: number
}

export function buildFolderTree(
  folders: { id: string; parent_id: string | null; name: string; path: string; description: string | null }[],
  documentCounts: Map<string, number>
): FolderTreeNode[] {
  const folderMap = new Map<string, FolderTreeNode>()
  const roots: FolderTreeNode[] = []

  // First pass: create all nodes
  for (const folder of folders) {
    folderMap.set(folder.id, {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      description: folder.description,
      children: [],
      document_count: documentCounts.get(folder.id) ?? 0,
    })
  }

  // Second pass: build tree
  for (const folder of folders) {
    const node = folderMap.get(folder.id)!
    if (folder.parent_id === null) {
      roots.push(node)
    } else {
      const parent = folderMap.get(folder.parent_id)
      if (parent) {
        parent.children.push(node)
      }
    }
  }

  return roots
}



