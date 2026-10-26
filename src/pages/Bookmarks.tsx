import React, { useState, useEffect } from 'react';
import { Post } from '../types';
import { ImageGrid } from '../components/ImageGrid';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import * as postsService from '../services/postsService';
import { Bookmark } from 'lucide-react';

export interface BookmarksProps {
  onPostClick: (post: Post) => void;
  onExploreClick: () => void;
}

export const Bookmarks: React.FC<BookmarksProps> = ({ onPostClick, onExploreClick }) => {
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBookmarks() {
      setLoading(true);
      try {
        const posts = await postsService.getBookmarkedPosts();
        setSavedPosts(posts);
      } finally {
        setLoading(false);
      }
    }
    loadBookmarks();
    const handleBookmarkChanged = () => {
      postsService.getBookmarkedPosts().then(setSavedPosts).catch(() => {});
    };
    window.addEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    return () => {
      window.removeEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2">
        <Bookmark className="w-5 h-5 text-amber-400 fill-amber-400" />
        <h1 className="text-xl font-bold text-white">Saved Posts</h1>
      </div>

      {loading ? (
        <LoadingState message="Loading your collection..." />
      ) : savedPosts.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="w-6 h-6 text-amber-500" />}
          title="No Saved Posts"
          description="Bookmark posts to save photography, inspiration, or notes for later viewing."
          actionText="Discover Posts"
          onAction={onExploreClick}
        />
      ) : (
        <ImageGrid posts={savedPosts} onPostClick={onPostClick} />
      )}
    </div>
  );
};
