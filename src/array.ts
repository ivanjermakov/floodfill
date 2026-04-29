export const zip = <T, U>(arr1: T[], arr2: U[]): [T, U][] => {
    const length = Math.min(arr1.length, arr2.length)
    const result: [T, U][] = []
    for (let i = 0; i < length; i++) {
        result.push([arr1[i], arr2[i]])
    }
    return result
}

export const groupBy = <K extends string | number, T>(arr: T[], keyFn: (elem: T) => K): Record<K, T[]> => {
    return arr.reduce(
        (result, e) => {
            const key = keyFn(e)
            result[key] ??= []
            result[key].push(e)
            return result
        },
        {} as Record<K, T[]>
    )
}
