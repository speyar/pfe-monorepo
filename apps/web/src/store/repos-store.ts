import { create } from "zustand";

type ReposFiltersStore = {
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  limit: number;
  setLimit: React.Dispatch<React.SetStateAction<number>>;
  resetFilters: () => void;
};

export const useReposFiltersStore = create<ReposFiltersStore>((set) => ({
  page: 1,
  setPage: (page) =>
    set((state) => ({
      page: typeof page === "function" ? page(state.page) : page,
    })),
  limit: 10,
  setLimit: (limit) =>
    set((state) => ({
      limit: typeof limit === "function" ? limit(state.limit) : limit,
    })),
  resetFilters: () => set({ page: 1, limit: 10 }),
}));
