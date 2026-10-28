import { create } from 'zustand'

type AutosfactoryBoardOpenState = {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useAutosfactoryBoardOpenStore = create<AutosfactoryBoardOpenState>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
