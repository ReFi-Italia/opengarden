import type { Access } from 'payload'

export const isAssessor: Access = ({ req: { user } }) => {
  const roles = user?.roles ?? []
  return (
    roles.includes('admin') ||
    roles.includes('manager') ||
    roles.includes('assessor')
  )
}
