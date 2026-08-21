(function(){'use strict';

const $=id=>document.getElementById(id);

let canvas=null;
let ctx=null;
let tool='brush';
let drawing=false;
let lastPoint=null;
let startPoint=null;
let history=[];
let future=[];
let layers=[];
let active=0;
let grid=false;
let zoom=1;

function toast(message,type){
    window.App?.toast?.(message,type);
}

function makeLayer(name){
    const c=document.createElement('canvas');

    c.width=canvas.width;
    c.height=canvas.height;

    return{
        name,
        c,
        visible:true,
        opacity:1
    };
}

function initCanvas(){

    canvas=$('wipaint-canvas');

    if(!canvas){
        console.error('WifiPaint: canvas não encontrado.');
        return;
    }

    ctx=canvas.getContext('2d',{
        willReadFrequently:true
    });

    layers=[
        makeLayer('Camada 1')
    ];

    active=0;

    renderLayers();

    render();

    history=[];
    future=[];

    saveHistory();

    attachCanvasEvents();
}

function attachCanvasEvents(){

    if(!canvas) return;

    canvas.style.touchAction='none';

    canvas.onpointerdown=pointerDown;
    canvas.onpointermove=pointerMove;
    canvas.onpointerup=pointerUp;
    canvas.onpointercancel=pointerUp;
    canvas.onpointerleave=()=>{};

    console.log('WifiPaint: eventos do canvas conectados.');
}

function resizeCanvas(){

    if(!canvas) return;

    canvas.style.transform=`scale(${zoom})`;
    canvas.style.transformOrigin='top left';

    render();
}

function render(){

    if(!canvas || !ctx) return;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.fillStyle='#ffffff';

    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    for(const layer of layers){

        if(!layer.visible) continue;

        ctx.save();

        ctx.globalAlpha=layer.opacity;

        ctx.drawImage(
            layer.c,
            0,
            0
        );

        ctx.restore();
    }

    if(grid){

        ctx.save();

        ctx.globalAlpha=.18;
        ctx.strokeStyle='#777';
        ctx.lineWidth=1;

        for(
            let x=0;
            x<canvas.width;
            x+=16
        ){

            ctx.beginPath();

            ctx.moveTo(x,0);
            ctx.lineTo(x,canvas.height);

            ctx.stroke();
        }

        for(
            let y=0;
            y<canvas.height;
            y+=16
        ){

            ctx.beginPath();

            ctx.moveTo(0,y);
            ctx.lineTo(canvas.width,y);

            ctx.stroke();
        }

        ctx.restore();
    }
}

function getPosition(e){

    const rect=
        canvas.getBoundingClientRect();

    const scaleX=
        canvas.width/rect.width;

    const scaleY=
        canvas.height/rect.height;

    return{
        x:Math.max(
            0,
            Math.min(
                canvas.width,
                (e.clientX-rect.left)*scaleX
            )
        ),

        y:Math.max(
            0,
            Math.min(
                canvas.height,
                (e.clientY-rect.top)*scaleY
            )
        )
    };
}

function getColor(){

    return $('wipaint-color')?.value || '#7c5cff';
}

function getSize(){

    return Number(
        $('wipaint-size')?.value || 12
    );
}

function getOpacity(){

    return Number(
        $('wipaint-opacity')?.value || 100
    )/100;
}

function setupBrush(c){

    const size=getSize();

    c.globalAlpha=getOpacity();

    c.strokeStyle=getColor();
    c.fillStyle=getColor();

    c.lineWidth=size;

    c.lineCap='round';
    c.lineJoin='round';

    if(tool==='pixel'){

        c.lineCap='butt';
        c.lineJoin='miter';

        c.lineWidth=
            Math.max(
                4,
                Math.round(size/4)*4
            );
    }

    if(tool==='eraser'){

        c.globalCompositeOperation=
            'destination-out';

    }else{

        c.globalCompositeOperation=
            'source-over';
    }
}

function currentLayer(){

    return layers[active];
}

function drawPoint(point){

    const layer=currentLayer();

    if(!layer) return;

    const c=
        layer.c.getContext('2d');

    setupBrush(c);

    if(tool==='pixel'){

        const size=
            Math.max(
                4,
                Math.round(getSize()/4)*4
            );

        c.fillRect(
            Math.floor(point.x/size)*size,
            Math.floor(point.y/size)*size,
            size,
            size
        );

    }else{

        c.beginPath();

        c.arc(
            point.x,
            point.y,
            Math.max(
                0.5,
                getSize()/2
            ),
            0,
            Math.PI*2
        );

        c.fill();
    }

    c.globalCompositeOperation=
        'source-over';
}

function drawLine(from,to){

    const layer=currentLayer();

    if(!layer) return;

    const c=
        layer.c.getContext('2d');

    setupBrush(c);

    c.beginPath();

    c.moveTo(
        from.x,
        from.y
    );

    c.lineTo(
        to.x,
        to.y
    );

    c.stroke();

    c.globalCompositeOperation=
        'source-over';
}

function pointerDown(e){

    if(e.button!==0) return;

    if(!canvas) return;

    e.preventDefault();

    try{
        canvas.setPointerCapture?.(
            e.pointerId
        );
    }catch{}

    const point=
        getPosition(e);

    drawing=true;

    startPoint=point;
    lastPoint=point;

    if(tool==='eyedropper'){

        const pixel=
            ctx.getImageData(
                Math.floor(point.x),
                Math.floor(point.y),
                1,
                1
            ).data;

        const color='#'+
            [pixel[0],pixel[1],pixel[2]]
            .map(
                n=>n
                    .toString(16)
                    .padStart(2,'0')
            )
            .join('');

        const input=
            $('wipaint-color');

        if(input)
            input.value=color;

        drawing=false;

        return;
    }

    if(tool==='fill'){

        const layer=currentLayer();

        const c=
            layer.c.getContext('2d');

        c.globalAlpha=
            getOpacity();

        c.fillStyle=
            getColor();

        c.fillRect(
            0,
            0,
            layer.c.width,
            layer.c.height
        );

        render();

        commit();

        drawing=false;

        return;
    }

    if(tool==='text'){

        const text=
            prompt('Digite o texto:');

        if(text){

            const layer=
                currentLayer();

            const c=
                layer.c.getContext('2d');

            c.globalAlpha=
                getOpacity();

            c.fillStyle=
                getColor();

            c.font=
                `600 ${Math.max(
                    14,
                    getSize()*2
                )}px Arial`;

            c.fillText(
                text,
                point.x,
                point.y
            );

            render();

            commit();
        }

        drawing=false;

        return;
    }

    if(
        tool==='brush' ||
        tool==='eraser' ||
        tool==='pixel'
    ){

        drawPoint(point);

        render();
    }
}

function pointerMove(e){

    if(!drawing) return;

    e.preventDefault();

    const point=
        getPosition(e);

    if(
        tool==='brush' ||
        tool==='eraser' ||
        tool==='pixel'
    ){

        drawLine(
            lastPoint,
            point
        );

        lastPoint=point;

        render();
    }
}

function pointerUp(e){

    if(!drawing) return;

    e.preventDefault();

    drawing=false;

    try{
        canvas.releasePointerCapture?.(
            e.pointerId
        );
    }catch{}

    if(
        tool==='brush' ||
        tool==='eraser' ||
        tool==='pixel' ||
        tool==='fill' ||
        tool==='text'
    ){

        commit();
    }

    startPoint=null;
    lastPoint=null;
}

function snapshot(){

    return layers.map(layer=>({

        name:layer.name,

        visible:layer.visible,

        opacity:layer.opacity,

        data:layer.c.toDataURL(
            'image/png'
        )
    }));
}

function restore(snapshotData){

    return Promise.all(
        snapshotData.map(item=>
            new Promise(resolve=>{

                const layer=
                    makeLayer(item.name);

                layer.visible=
                    item.visible;

                layer.opacity=
                    item.opacity;

                const image=
                    new Image();

                image.onload=()=>{

                    layer.c
                        .getContext('2d')
                        .drawImage(
                            image,
                            0,
                            0
                        );

                    resolve(layer);
                };

                image.src=item.data;
            })
        )
    ).then(newLayers=>{

        layers=newLayers;

        active=
            Math.min(
                active,
                layers.length-1
            );

        renderLayers();

        render();
    });
}

function saveHistory(){

    history.push(
        snapshot()
    );

    if(history.length>40)
        history.shift();

    future=[];
}

async function undo(){

    if(history.length<=1){

        toast(
            'Nada para desfazer.',
            'error'
        );

        return;
    }

    const current=
        history.pop();

    future.push(current);

    await restore(
        history[history.length-1]
    );
}

async function redo(){

    if(!future.length){

        toast(
            'Nada para refazer.',
            'error'
        );

        return;
    }

    const state=
        future.pop();

    history.push(state);

    await restore(state);
}

function commit(){

    saveHistory();
}

function renderLayers(){

    const box=
        $('wipaint-layers');

    if(!box) return;

    box.innerHTML=
        layers.map(
            (layer,index)=>`

                <div
                    class="wipaint-layer ${
                        index===active
                            ?'active'
                            :''
                    }"
                    data-layer="${index}"
                >

                    <button
                        type="button"
                        data-visible="${index}"
                    >
                        ${
                            layer.visible
                                ?'👁️'
                                :'🚫'
                        }
                    </button>

                    <span>
                        ${layer.name}
                    </span>

                </div>
            `
        ).join('');

    box
        .querySelectorAll(
            '[data-layer]'
        )
        .forEach(element=>{

            element.onclick=()=>{

                active=
                    Number(
                        element.dataset.layer
                    );

                renderLayers();
            };
        });

    box
        .querySelectorAll(
            '[data-visible]'
        )
        .forEach(button=>{

            button.onclick=e=>{

                e.stopPropagation();

                const index=
                    Number(
                        button.dataset.visible
                    );

                layers[index].visible=
                    !layers[index].visible;

                renderLayers();

                render();

                commit();
            };
        });
}

function addLayer(){

    layers.push(
        makeLayer(
            `Camada ${layers.length+1}`
        )
    );

    active=
        layers.length-1;

    renderLayers();

    render();

    commit();
}

function deleteLayer(){

    if(layers.length<=1){

        toast(
            'Você precisa manter uma camada.',
            'error'
        );

        return;
    }

    layers.splice(
        active,
        1
    );

    active=
        Math.max(
            0,
            active-1
        );

    renderLayers();

    render();

    commit();
}

function clearCanvas(){

    const layer=
        currentLayer();

    if(!layer) return;

    layer.c
        .getContext('2d')
        .clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

    render();

    commit();
}

function savePNG(){

    const output=
        document.createElement('canvas');

    output.width=
        canvas.width;

    output.height=
        canvas.height;

    const outputCtx=
        output.getContext('2d');

    outputCtx.fillStyle=
        '#ffffff';

    outputCtx.fillRect(
        0,
        0,
        output.width,
        output.height
    );

    for(const layer of layers){

        if(!layer.visible)
            continue;

        outputCtx.globalAlpha=
            layer.opacity;

        outputCtx.drawImage(
            layer.c,
            0,
            0
        );
    }

    outputCtx.globalAlpha=1;

    const link=
        document.createElement('a');

    link.download=
        `wipaint-${Date.now()}.png`;

    link.href=
        output.toDataURL(
            'image/png'
        );

    link.click();
}

function loadImage(file){

    if(!file) return;

    const image=
        new Image();

    image.onload=()=>{

        const maxWidth=1400;
        const maxHeight=1000;

        const scale=
            Math.min(
                1,
                maxWidth/image.width,
                maxHeight/image.height
            );

        canvas.width=
            Math.max(
                1,
                Math.round(
                    image.width*scale
                )
            );

        canvas.height=
            Math.max(
                1,
                Math.round(
                    image.height*scale
                )
            );

        ctx=
            canvas.getContext('2d');

        layers=[
            makeLayer('Imagem')
        ];

        layers[0].c
            .getContext('2d')
            .drawImage(
                image,
                0,
                0,
                canvas.width,
                canvas.height
            );

        active=0;

        history=[];
        future=[];

        renderLayers();

        render();

        saveHistory();

        URL.revokeObjectURL(
            image.src
        );
    };

    image.src=
        URL.createObjectURL(file);
}

function keyboard(e){

    const modifier=
        e.ctrlKey ||
        e.metaKey;

    if(
        modifier &&
        e.key.toLowerCase()==='z'
    ){

        e.preventDefault();

        undo();

        return;
    }

    if(
        modifier &&
        e.key.toLowerCase()==='y'
    ){

        e.preventDefault();

        redo();

        return;
    }

    if(
        modifier &&
        e.key.toLowerCase()==='s'
    ){

        e.preventDefault();

        savePNG();

        return;
    }

    if(e.key==='Escape'){

        drawing=false;

        startPoint=null;
        lastPoint=null;

        return;
    }

    const key=
        e.key.toLowerCase();

    if(key==='b')
        tool='brush';

    else if(key==='e')
        tool='eraser';

    else if(key==='p')
        tool='pixel';

    else if(key==='i')
        tool='eyedropper';

    else if(key==='t')
        tool='text';

    syncTool();
}

function syncTool(){

    const select=
        $('wipaint-tool');

    if(select)
        select.value=tool;
}

function bind(){

    const openButton=
        $('wipaint-open-btn');

    if(!openButton){

        console.warn(
            'WifiPaint: botão de abertura não encontrado.'
        );

        return;
    }

    openButton.onclick=()=>{

        $('modal-overlay')
            ?.classList
            .remove('hidden');

        document
            .querySelectorAll('.modal')
            .forEach(
                modal=>
                    modal.classList
                        .add('hidden')
            );

        $('modal-wipaint')
            ?.classList
            .remove('hidden');

        if(!canvas)
            initCanvas();
    };

    $('wipaint-tool')
        ?.addEventListener(
            'change',
            e=>{
                tool=e.target.value;
            }
        );

    $('wipaint-size')
        ?.addEventListener(
            'input',
            e=>{

                const label=
                    $('wipaint-size-value');

                if(label)
                    label.textContent=
                        `${e.target.value} px`;
            }
        );

    $('wipaint-zoom')
        ?.addEventListener(
            'input',
            e=>{

                zoom=
                    Number(
                        e.target.value
                    )/100;

                resizeCanvas();
            }
        );

    $('wipaint-undo')
        ?.addEventListener(
            'click',
            undo
        );

    $('wipaint-redo')
        ?.addEventListener(
            'click',
            redo
        );

    $('wipaint-clear')
        ?.addEventListener(
            'click',
            clearCanvas
        );

    $('wipaint-grid')
        ?.addEventListener(
            'click',
            ()=>{

                grid=!grid;

                render();
            }
        );

    $('wipaint-add-layer')
        ?.addEventListener(
            'click',
            addLayer
        );

    $('wipaint-delete-layer')
        ?.addEventListener(
            'click',
            deleteLayer
        );

    $('wipaint-save')
        ?.addEventListener(
            'click',
            savePNG
        );

    $('wipaint-open-image')
        ?.addEventListener(
            'click',
            ()=>
                $('wipaint-file-input')
                    ?.click()
        );

    $('wipaint-file-input')
        ?.addEventListener(
            'change',
            e=>
                loadImage(
                    e.target.files?.[0]
                )
        );

    console.log(
        'WifiPaint carregado com sucesso.'
    );
}

document.addEventListener(
    'DOMContentLoaded',
    bind
);

window.WiPaint={
    open:()=>{
        $('wipaint-open-btn')
            ?.click();
    }
};

})();
