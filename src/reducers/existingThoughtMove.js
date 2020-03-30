// util
import {
  addContext,
  compareByRank,
  equalArrays,
  equalPath,
  equalThoughtRanked,
  getNextRank,
  getThought,
  getThoughts,
  getThoughtsRanked,
  hashContext,
  hashThought,
  head,
  headRank,
  moveThought,
  pathToContext,
  reduceObj,
  removeContext,
  removeDuplicatedContext,
  rootedContextOf,
  sort,
  sync,
  timestamp,
  updateUrlHistory,
} from '../util.js'

import { treeMove } from '../util/recentlyEditedTree.js'

// side effect: sync
export default (state, { oldPath, newPath, offset }) => {
  const thoughtIndex = { ...state.thoughtIndex }
  const oldThoughts = pathToContext(oldPath)
  const newThoughts = pathToContext(newPath)
  const value = head(oldThoughts)
  const key = hashThought(value)
  const oldRank = headRank(oldPath)
  const newRank = headRank(newPath)
  const oldContext = rootedContextOf(oldThoughts)
  const newContext = rootedContextOf(newThoughts)
  const sameContext = equalArrays(oldContext, newContext)
  const oldThought = getThought(value, thoughtIndex)
  const newThought = removeDuplicatedContext(moveThought(oldThought, oldContext, newContext, oldRank, newRank), newContext)
  const editing = equalPath(state.cursorBeforeEdit, oldPath)

  // Uncaught TypeError: Cannot perform 'IsArray' on a proxy that has been revoked at Function.isArray (#417)
  let recentlyEdited = state.recentlyEdited // eslint-disable-line fp/no-let
  try {
    recentlyEdited = treeMove(state.recentlyEdited, oldPath, newPath)
  }
  catch (e) {
    console.error('existingThoughtMove: treeMove immer error')
    console.error(e)
  }

  // preserve contextIndex
  const contextEncodedOld = hashContext(oldContext)
  const contextEncodedNew = hashContext(newContext)

  // if the contexts have changed, remove the value from the old contextIndex and add it to the new
  const subthoughtsOld = getThoughts(oldContext, state.thoughtIndex, state.contextIndex)
    .filter(child => !equalThoughtRanked(child, { value, rank: oldRank }))

  const firstDuplicateSubthought = sort(
    getThoughts(newContext, state.thoughtIndex, state.contextIndex)
      .filter(child => child.value === value),
    compareByRank
  )[0]

  const subthoughtsNew = getThoughts(newContext, state.thoughtIndex, state.contextIndex)
    .filter(child => !equalThoughtRanked(child, { value, rank: oldRank }, sameContext))
    .concat({
      value,
      rank: (firstDuplicateSubthought && !sameContext) ? firstDuplicateSubthought.rank : newRank,
      lastUpdated: timestamp()
    })

  const recursiveUpdates = (oldThoughtsRanked, newThoughtsRanked, contextRecursive = [], accumRecursive = {}) => {

    const newLastRank = getNextRank(newThoughtsRanked, state.thoughtIndex, state.contextIndex)

    return getThoughtsRanked(oldThoughtsRanked, state.thoughtIndex, state.contextIndex).reduce((accum, child, i) => {
      const hashedKey = hashThought(child.value)
      const childThought = getThought(child.value, thoughtIndex)

      // remove and add the new context of the child
      const contextNew = newThoughts.concat(contextRecursive)

      // update rank of first depth of childs
      const movedRank = newLastRank ? newLastRank + i : child.rank
      const childNewThought = removeDuplicatedContext(addContext(removeContext(childThought, pathToContext(oldThoughtsRanked), child.rank), contextNew, movedRank), contextNew)

      // update local thoughtIndex so that we do not have to wait for firebase
      thoughtIndex[hashedKey] = childNewThought

      const accumNew = {
        // merge ancestor updates
        ...accumRecursive,
        // merge sibling updates
        // Order matters: accum must have precendence over accumRecursive so that contextNew is correct
        ...accum,
        // merge current thought update
        [hashedKey]: {
          value: child.value,
          rank: (childNewThought.contexts || []).find(context => equalArrays(context.context, contextNew)).rank,
          thoughtIndex: childNewThought,
          context: pathToContext(oldThoughtsRanked),
          contextsOld: ((accumRecursive[hashedKey] || {}).contextsOld || []).concat([pathToContext(oldThoughtsRanked)]),
          contextsNew: ((accumRecursive[hashedKey] || {}).contextsNew || []).concat([contextNew])
        }
      }

      return {
        ...accumNew,
        ...recursiveUpdates(oldThoughtsRanked.concat(child), newThoughtsRanked.concat(child), contextRecursive.concat(child.value), accumNew)
      }
    }, {})
  }

  const descendantUpdatesResult = recursiveUpdates(oldPath, newPath)
  const descendantUpdates = reduceObj(descendantUpdatesResult, (key, value) => ({
    [key]: value.thoughtIndex
  }))

  const contextIndexDescendantUpdates = sameContext
    ? {}
    : reduceObj(descendantUpdatesResult, (hashedKey, result, accumContexts) =>
      result.contextsOld.reduce((accum, contextOld, i) => {
        const contextNew = result.contextsNew[i]
        const contextEncodedOld = hashContext(contextOld)
        const contextEncodedNew = hashContext(contextNew)
        return {
          ...accum,

          // TODO: Merge contextIndex entry
          [contextEncodedOld]: {
            thoughts: ((accumContexts[contextEncodedOld] && accumContexts[contextEncodedOld].thoughts) || getThoughts(contextOld, state.thoughtIndex, state.contextIndex))
              .filter(child => child.value !== result.value)
          },
          [contextEncodedNew]: {
            thoughts: ((accumContexts[contextEncodedNew] && accumContexts[contextEncodedNew].thoughts) || getThoughts(contextNew, state.thoughtIndex, state.contextIndex))
              .filter(child => child.value !== result.value)
              .concat({
                value: result.value,
                rank: result.rank,
                lastUpdated: timestamp()
              })
          }
        }
      }, {})
    )

  const contextIndexUpdates = {
    // TODO: Merge contextIndex entry
    [contextEncodedOld]: { thoughts: subthoughtsOld },
    [contextEncodedNew]: { thoughts: subthoughtsNew },
    ...contextIndexDescendantUpdates
  }

  const contextIndexNew = {
    ...state.contextIndex,
    ...contextIndexUpdates
  }
  Object.keys(contextIndexNew).forEach(contextEncoded => {
    const contextIndexEntry = contextIndexNew[contextEncoded]
    if (!contextIndexEntry || contextIndexEntry.thoughts.length === 0) {
      delete contextIndexNew[contextEncoded] // eslint-disable-line fp/no-delete
    }
  })

  const thoughtIndexUpdates = {
    [key]: newThought,
    ...descendantUpdates
  }

  thoughtIndex[key] = newThought

  // preserve contextViews
  const contextViewsNew = { ...state.contextViews }
  if (state.contextViews[contextEncodedNew] !== state.contextViews[contextEncodedOld]) {
    contextViewsNew[contextEncodedNew] = state.contextViews[contextEncodedOld]
    delete contextViewsNew[contextEncodedOld] // eslint-disable-line fp/no-delete
  }

  setTimeout(() => {
    // do not sync to state since this reducer returns the new state
    sync(thoughtIndexUpdates, contextIndexUpdates, { state: false, recentlyEdited })

    if (editing) {
      updateUrlHistory(newPath, { replace: true })
    }
  })

  return {
    thoughtIndex,
    dataNonce: state.dataNonce + 1,
    cursor: editing ? newPath : state.cursor,
    cursorBeforeEdit: editing ? newPath : state.cursorBeforeEdit,
    cursorOffset: offset,
    contextIndex: contextIndexNew,
    contextViews: contextViewsNew,
    recentlyEdited
  }
}
