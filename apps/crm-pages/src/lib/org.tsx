import { useQuery } from '@tanstack/react-query';
import { getPublicOrg, type GetPublicOrgOutputType } from 'zitejs/api';
import { useEffect } from 'react';
import { applyBrand } from './brand';

/**
 * Loads the organization's branding once per visit and paints it onto the page.
 * Every public page uses it, so a buyer always sees the vendor's name and colour.
 */
export function useOrg() {
  const query = useQuery({
    queryKey: ['org'],
    queryFn: () => getPublicOrg({ pagesUrl: window.location.origin + window.location.pathname.replace(/\/$/, '') }),
    staleTime: 10 * 60_000,
  });
  useEffect(() => {
    if (query.data?.brandColor) applyBrand(query.data.brandColor);
  }, [query.data?.brandColor]);
  useEffect(() => {
    // The tab should name whoever sent the link, not the page type.
    if (query.data?.organizationName) document.title = query.data.organizationName;
  }, [query.data?.organizationName]);
  return query;
}

export type Org = GetPublicOrgOutputType;
