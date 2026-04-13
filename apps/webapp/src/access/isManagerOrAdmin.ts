import type { Access } from 'payload'

export const isManagerOrAdmin: Access = ({ req: { user } }) => {
  const roles = user?.roles ?? []
  return roles.includes('admin') || roles.includes('manager')
}
