import { useEffect, useState } from 'react'

function parse() {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [name = '', id = ''] = h.split('/')
  return { name: name || 'analyze', id }
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const navigate = (path) => { window.location.hash = `#/${path}` }
