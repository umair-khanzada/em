import globals from '../globals'

// constants
import {
  EXPAND_THOUGHT_CHAR,
  MAX_EXPAND_DEPTH,
  RANKED_ROOT,
} from '../constants'

// util
import {
  contextChainToPath,
  contextOf,
  excludeMetaThoughts,
  getChildPath,
  hashContext,
  isURL,
  pathToContext,
  unroot,
} from '../util'

// selectors
import { expandThoughts } from '../selectors'
import attribute from '../selectors/attribute'
import getThoughtsRanked from '../selectors/getThoughtsRanked'

const publish = new URLSearchParams(window.location.search).get('publish') != null

/** Returns an expansion map marking all contexts that should be expanded
  * @example {
    [hashContext(context)]: true,
    [hashContext(context.concat(childA))]: true,
    [hashContext(context.concat(childB))]: true,
    [hashContext(context.concat(childC))]: true,
    ...
  }
*/
export default ({ thoughtIndex, contextIndex, contextViews }, path, contextChain = [], { depth = 0 } = {}) => {

  if (
    // arbitrarily limit depth to prevent infinite context view expansion (i.e. cycles)
    depth > MAX_EXPAND_DEPTH ||
    // suppress expansion if left command is held down after cursorDown
    globals.suppressExpansion
  ) return {}

  const thoughtsRanked = !path || path.length === 0 ? RANKED_ROOT
    : contextChain.length > 0 ? contextChainToPath(contextChain)
    : path

  const children = excludeMetaThoughts(getThoughtsRanked({ contextIndex, thoughtIndex }, thoughtsRanked))

  // expand if child is only child and its child is not url
  const subChildren = children.length === 1
    ? getThoughtsRanked({ contextIndex, thoughtIndex }, (path || []).concat(children[0]))
    : null
  const isOnlyChildNoUrl = subChildren &&
    (subChildren.length !== 1 || !isURL(subChildren[0].value))

  const isTable = () => attribute({ contextIndex, thoughtIndex }, thoughtsRanked, '=view') === 'Table'
  const pinChildren = () => attribute(pathToContext(thoughtsRanked), '=pinChildren', { state: { thoughtIndex, contextIndex } }) !== undefined

  /** check for =publish/=attributes/pinChildren in publish mode
      Note: Use 'pinChildren' so it is not interpreted in editing mode
  */
  const publishPinChildren = publish && attribute(
    unroot(pathToContext(thoughtsRanked).concat(['=publish', '=attributes'])),
    'pinChildren',
    { state: { thoughtIndex, contextIndex } }
  ) !== undefined

  return (isOnlyChildNoUrl || isTable() || pinChildren() || publishPinChildren
    ? children
    : children.filter(child => {
      const isPinned = attribute({ contextIndex, thoughtIndex }, getChildPath(child, thoughtsRanked), '=pin', { state: { thoughtIndex, contextIndex } }) === 'true'
      return child.value[child.value.length - 1] === EXPAND_THOUGHT_CHAR || isPinned
    })
  ).reduce(
    (accum, child) => {
      const newContextChain = (contextChain || [])
        .map(thoughts => thoughts.concat())
        .concat(contextChain.length > 0 ? [[child]] : [])

      return Object.assign({}, accum,
        // RECURSIVE
        // passing contextChain here creates an infinite loop
        expandThoughts({ thoughtIndex, contextIndex, contextViews }, (path || []).concat(child), newContextChain, { depth: depth + 1 })
      )
    },
    {
      // expand current thought
      [hashContext(path || [])]: true,

      // expand context
      // this allows expansion of column 1 when the cursor is on column 2 in the table view, and uncles of the cursor that end in ":"
      // RECURSION
      ...(path && path.length >= 1 && depth <= 1
        ? expandThoughts({ thoughtIndex, contextIndex, contextViews }, contextOf(path), contextChain, { depth: depth + 1 })
        : {})
    }
  )
}