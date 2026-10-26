import React, { useState, useEffect, useMemo } from 'react';
import { Post, User } from '../types';
import { SearchBar } from '../components/SearchBar';
import { UserCard } from '../components/UserCard';
import { ImageGrid } from '../components/ImageGrid';
import { LoadingState } from '../components/LoadingState';
import * as postsService from '../services/postsService';
import * as usersService from '../services/usersService';
import { useAuth } from '../hooks/useAuth';
import { Sparkles, Users } from 'lucide-react';

export interface DiscoverProps {
  onPostClick: (post: Post) => void;
  onUserClick: (userId: string) => void;
}

const CATEGORIES = ['All', 'Photography', 'Design', 'Architecture', 'Travel', 'Tech'];

export const Discover: React.FC<DiscoverProps> = ({ onPostClick, onUserClick }) => {
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [posts, setPosts] = useState<Post[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDiscoverData() {
      setLoading(true);
      try {
        const [allPosts, users] = await Promise.all([
          postsService.getFeedPosts(),
          usersService.getSuggestedUsers(),
        ]);
        setPosts(allPosts);
        setSuggestedUsers(users);
      } finally {
        setLoading(false);
      }
    }
    loadDiscoverData();

    const handleFollowChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetUserId: string; isFollowing: boolean }>;
      if (customEvent.detail) {
        setSuggestedUsers((prev) =>
          prev.map((u) =>
            u.id === customEvent.detail.targetUserId
              ? {
                  ...u,
                  isFollowing: customEvent.detail.isFollowing,
                  followersCount: customEvent.detail.isFollowing
                    ? u.followersCount + 1
                    : Math.max(0, u.followersCount - 1),
                }
              : u
          )
        );
      }
    };

    window.addEventListener('sogo_follow_changed', handleFollowChanged);
    return () => {
      window.removeEventListener('sogo_follow_changed', handleFollowChanged);
    };
  }, []);

  const handleFollowToggle = async (userId: string) => {
    await usersService.toggleFollowUser(userId, currentUser);
    setSuggestedUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, isFollowing: !u.isFollowing } : u))
    );
  };

  // Filter posts based on search query and category
  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      const matchesSearch =
        !searchQuery ||
        post.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCategory =
        selectedCategory === 'All' ||
        post.tags?.some((t) => t.toLowerCase().includes(selectedCategory.toLowerCase()));

      return matchesSearch && matchesCategory;
    });
  }, [posts, searchQuery, selectedCategory]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return [];
    return suggestedUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.displayName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [suggestedUsers, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-sm space-y-3">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search creators, #tags, or inspiration..."
        />

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all focus:outline-none cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm shadow-cyan-500/20 font-bold'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-white border border-slate-700/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Discovering posts & creators..." />
      ) : (
        <>
          {/* User Search Results */}
          {searchQuery && filteredUsers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                Creators
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredUsers.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onFollowToggle={handleFollowToggle}
                    onUserClick={onUserClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Suggested Creators (shown if no query) */}
          {!searchQuery && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Suggested Creators
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {suggestedUsers.slice(0, 4).map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onFollowToggle={handleFollowToggle}
                    onUserClick={onUserClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Explore Image Grid */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {searchQuery ? `Explore Results (${filteredPosts.length})` : 'Trending on SogoSocial'}
            </h3>
            <ImageGrid
              posts={filteredPosts}
              onPostClick={onPostClick}
              emptyMessage="No posts match your search or filter."
            />
          </div>
        </>
      )}
    </div>
  );
};
