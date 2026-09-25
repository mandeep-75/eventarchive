import { useEffect, useState } from 'react'
import { subscribeDepartments } from '../supabase/data'
import type { Department } from '../types'

export function useDepartments() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeDepartments((data) => {
      setDepartments(data)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const getDepartment = (id: string | null) =>
    id ? departments.find((d) => d.id === id) : undefined

  return { departments, getDepartment, loading }
}