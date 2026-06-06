// biome-ignore format:
type AssertSearchParams<Required extends string, Optional extends string>
    = { [_ in Required]: string }
    & { [_ in Optional]: string | undefined }
export const assertSearchParams = <Required extends string, Optional extends string>(
    url: URL,
    required: readonly Required[],
    optional?: readonly Optional[]
): AssertSearchParams<Required, Optional> => {
    const typed: Record<string, string | undefined> = {}
    for (const param of required) {
        const p = url.searchParams.get(param)
        if (!p) throw Error(`no param: ${param}`)
        typed[param] = p
    }
    if (optional) {
        for (const param of optional) {
            typed[param] = url.searchParams.get(param) ?? undefined
        }
    }
    return typed as AssertSearchParams<Required, Optional>
}
