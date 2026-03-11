import { create } from "zustand";

type ReposFiltersStore = {
  page: number;
  setPage: (page: number) => void;
  limit: number;
  setLimit: (limit: number) => void;
  resetFilters: () => void;
};

export const useReposFiltersStore = create<ReposFiltersStore>((set) => ({
  page: 1,
  setPage: (page) => set({ page }),
  limit: 10,
  setLimit: (limit) => set({ limit }),
  resetFilters: () => set({ page: 1, limit: 10 }),
}));
