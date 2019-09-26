import * as _ from 'lodash';
import { LiteElement } from 'mathjax-full/js/adaptors/lite/Element';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
import { MathDocument } from 'mathjax-full/js/core/MathDocument';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { TeX } from 'mathjax-full/js/input/tex';
import TexParser from 'mathjax-full/js/input/tex/TexParser';
import { mathjax } from 'mathjax-full/js/mathjax';
import { SVG } from 'mathjax-full/js/output/svg';
import { MathToSVGConfig, mathToSVGDefaultConfig } from './Config';
import * as matrixUtil from 'transformation-matrix/src/index';

function parseSize(size: string | number, config: Partial<MathToSVGConfig> = {}) {
    if (typeof size === 'number') return size;
    const unit = size.substr(-2);
    return _.get(config, unit, 1) * parseFloat(size);
}

export class MathjaxAdaptor {
    private html: MathDocument<any, any, any>;
    private tex: TeX;   //  html.inputJax
    private svg: SVG;    //  html.outputJax
    options: MathToSVGConfig;
    key = _.uniqueId('MathjaxAdaptor')

    constructor(options: MathToSVGConfig) {
        this.options = options;
        //
        //  Create DOM adaptor and register it for HTML documents
        //
        const adaptor = liteAdaptor();
        RegisterHTMLHandler(adaptor);

        //
        //  Create input and output jax and a document using them on the content from the HTML file
        //
        this.tex = new TeX({ packages: options.packages });
        this.svg = new SVG({ fontCache: (options.fontCache ? 'local' : 'none') });
        this.html = mathjax.document('', { InputJax: this.tex, OutputJax: this.svg });
    }

    protected get adaptor() {
        return this.html.adaptor as ReturnType<typeof liteAdaptor>;
    }

    protected get convertOptions() {
        return {
            display: !this.options.inline,
            em: this.options.em,
            ex: this.options.ex,
            containerWidth: this.options.width
        }
    }

    protected get parseOptions() {
        return this.tex.parseOptions;
    }

    static parseSVG(svg: string) {
        return _.replace(svg, /xlink:xlink/g, 'xlink');
    }

    convert = _.memoize((math: string) => {
        return this.html.convert(math, this.convertOptions) as LiteElement;
    })

    splitMath = _.memoize((math: string) => {
        let parser = new TexParser(
            math,
            { display: true, isInner: false },
            this.parseOptions
        );

        parser.i = 0;   //  reset parser
        const response = [];
        while (parser.i < parser.string.length) {
            response.push(parser.GetArgument(math, true))
        }
        return response as string[];
    })

    toSVG = _.memoize((math: string) => {
        const node = this.convert(math);
        return MathjaxAdaptor.parseSVG(this.adaptor.innerHTML(node)) as string; //   css option won't be used in react-native context    //   opts.css ? adaptor.textContent(svg.styleSheet(html)) : adaptor.innerHTML(node);
    })

    toSVGArray(math: string) {
        /*
        return _.map(this.splitMath(math), this.toSVG.bind(this)) as string[];
        */
        const useCollection = this.elementsByTag(this.convert(math), 'use'));
        console.log(_.map(useCollection, (n)=>this.accTransformations(n)))
       // console.log(this.elementsByTag(this.adaptor.firstChild(this.convert(math)), 'use'))
        const nodeList = accumulateTransformations(this.adaptor.clone(this.adaptor.firstChild(this.convert(math))), this.adaptor);
        
        return _.map(nodeList, node => MathjaxAdaptor.parseSVG(this.adaptor.outerHTML(node)));
        
    }

    elementsByTag(node: LiteElement, name: string) {
        let stack = [] as LiteNode[];
        let tags = [] as LiteElement[];
        let n: LiteNode = node;
        while (n) {
            if (n.kind !== '#text' && n.kind !== '#comment') {
                n = n as LiteElement;
                console.log(n.kind, _.isEqual(n.kind, name))
                if (_.isEqual(n.kind, name)) {
                    tags.push(n)
                }
                if (n.children.length) {
                    stack = n.children.concat(stack);
                }
            }
            n = stack.shift();
        }
        return tags;
    }

    transformationToMatrix(node: LiteElement) {
        const transformAttr = _.get(node.attributes, 'transform', null);
        if (!transformAttr) return;

        const mat = matrixUtil.compose(matrixUtil.fromTransformAttribute(transformAttr));

        switch (mat.type) {
            case 'matrix':
                return mat;
            case 'translate':
                return matrixUtil.compose(matrixUtil.translate(mat.tx, mat.ty || 0));
        }
        return transformAttr && matrixUtil.fromTransformAttribute(transformAttr);
    }

    accTransformations(node: LiteElement) {
        let n = node;
        const matrices = [];
        while (n.parent) {
            matrices.push(this.transformationToMatrix(n));
            n = n.parent;
        }
        return matrixUtil.toSVG(matrixUtil.compose(_.compact(matrices)));
    }


    /**
     * doesn't seem to increase performance dramatically, maybe even the opposite
     * use at own risk
     * @param mathArray
     */
    preload(mathArray: string[]) {
        if (_.size(mathArray) > 0) {
            setTimeout(() => {
                _.map(mathArray, (math) => this.toSVG(math));
                if (__DEV__) console.log('react-native-math-view: Mathjax preload completed');
            }, 0);
        }
    }
}

export const FactoryMemoize = _.memoize((stringifiedOptions: string) => new MathjaxAdaptor(JSON.parse(stringifiedOptions) as MathToSVGConfig));

export default function (config?: Partial<MathToSVGConfig>) {
    return FactoryMemoize(JSON.stringify(_.defaultsDeep(config || {}, mathToSVGDefaultConfig)));
}

export function accumulateTransformations(node: LiteElement, adaptor: LiteAdaptor) {
    let pathToDefs: Array<number | string> = [0];
    const response: any[] = [];
    //console.log( node.attributes)
    

    recurseThroughTree(node, (childNode, path) => {
        if (childNode.kind === 'defs') pathToDefs = path;
        else if (_.startsWith(_.join(path), _.join(pathToDefs))) return;

        if (childNode.kind === 'use') {

            const treeNodeList = _.map(_.without(path, 'children'), (key, index, collection) => {
                const p = _.slice(collection, 0, index + 1);
                return _.get(node, _.flatten(_.map(p, seg => (['children', seg]))));
            });

            const transformations = _.compact(_.map(treeNodeList, (node) => {
                const transformAttr = _.get(node.attributes, 'transform', null);
                if (!transformAttr) return;

                const mat = matrixUtil.compose(matrixUtil.fromTransformAttribute(transformAttr));

                switch (mat.type) {
                    case 'matrix':
                        return mat;
                    case 'translate':
                        return matrixUtil.compose(matrixUtil.translate(mat.tx, mat.ty || 0));
                }
                return transformAttr && matrixUtil.fromTransformAttribute(transformAttr);
            }));

            //console.log(treeNodeList[0].attributes, matrixUtil.toSVG(matrixUtil.compose(transformations)))

            adaptor.setAttribute(treeNodeList[0], 'transform', matrixUtil.toSVG(matrixUtil.compose(transformations)))
           // console.log(_.keys(adaptor))

            const tree = _.reduceRight(_.initial(treeNodeList), (prev, curr, index, list) => {
                return _.assign({}, curr, { children: [prev] });
            }, _.last(treeNodeList));

            response.push(_.set(_.assign({}, node), 'children', [_.get(node, `children.0`), tree]));
        }
    });

    return response as LiteElement;
}

/**
 * This method iterates through the entire node and breaks it up into seperate SVG node,
 * each containing a single leaf and it's entire tree
 * This was developed in order to manage seperate symbols in a math string
 * @param node adaptor.firstChild(node)
 */
export function breakIntoSeperateTrees(node: any) {
    let pathToDefs: Array<number | string> = [0];
    const response: any[] = [];
    //console.log( node.attributes)
    recurseThroughTree(node, (childNode, path) => {
        if (childNode.kind === 'defs') pathToDefs = path;
        else if (_.startsWith(_.join(path), _.join(pathToDefs))) return;

        if (childNode.kind === 'use') {

            const treeNodeList = _.map(_.without(path, 'children'), (key, index, collection) => {
                const p = _.slice(collection, 0, index + 1);
                return _.get(node, _.flatten(_.map(p, seg => (['children', seg]))));
            });

            const tree = _.reduceRight(_.initial(treeNodeList), (prev, curr, index, list) => {
                return _.assign({}, curr, { children: [prev] });
            }, _.last(treeNodeList));

            response.push(_.set(_.assign({}, node), 'children', [_.get(node, `children.0`), tree]));
        }
    });

    return response as LiteElement;
}

function recurseThroughTree(node: any, callback: (node: any, path: string[]) => any, path: string[] = []) {
    path.push('children');
    _.map(node.children, (child, key) => {
        const p = _.concat(path, key);
        callback(child, p)
        recurseThroughTree(child, callback, p)
    });
}
