export interface FeedPhoto {
  id: string;
  takenAt: string;
  caption: string | null;
  width: number;
  height: number;
  srcset: Record<string, string>;
}

export interface AdminPhoto extends FeedPhoto {
  hidden: boolean;
}

export interface FeedPage<P = FeedPhoto> {
  project: { slug: string; name: string };
  photos: P[];
  nextCursor: string | null;
}

export interface ProjectSummary {
  slug: string;
  name: string;
  siteUrl: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
